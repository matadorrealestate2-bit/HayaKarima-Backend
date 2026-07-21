const APP_NAME = "HayaKarima Backend";
const DEFAULT_VERSION = "2.0.0";
const MAX_SYNC_EVENTS = 1000;

const CENTERS = [
  "طنطا",
  "المحلة الكبرى",
  "كفر الزيات",
  "زفتى",
  "السنطة",
  "بسيون",
  "قطور",
  "سمنود",
];

let schemaReady = null;

export default {
  async fetch(request, env) {
    const corsHeaders = buildCorsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);
      const route = normalizeRoute(url.pathname);

      if (route === "/" && request.method === "GET") {
        return jsonResponse(
          {
            success: true,
            status: "success",
            message: "خادم حياة كريمة يعمل بنجاح.",
            data: {
              name: APP_NAME,
              version: env.APP_VERSION || DEFAULT_VERSION,
              endpoints: ["/ping", "/api/events", "/api/sync"],
            },
            timestamp: new Date().toISOString(),
          },
          200,
          corsHeaders,
        );
      }

      if (route === "/ping" && request.method === "GET") {
        return success(
          {
            version: env.APP_VERSION || DEFAULT_VERSION,
            connected: true,
            databaseConfigured: Boolean(env.DB),
          },
          "الاتصال يعمل بنجاح.",
          corsHeaders,
        );
      }

      // Compatibility with the previous Android/Apps Script action format.
      if (route === "/" && url.searchParams.has("action")) {
        const action = normalizeAction(url.searchParams.get("action"));
        return handleAction(action, Object.fromEntries(url.searchParams), request, env, corsHeaders);
      }

      if (request.method === "POST" && route === "/") {
        const body = await readJsonBody(request);
        const action = normalizeAction(body.action);
        return handleAction(action, body, request, env, corsHeaders);
      }

      if (route === "/api/events" && request.method === "GET") {
        await authorize(request, env);
        await ensureDatabase(env);
        const events = await getEvents(env.DB);
        return success(events, "تم جلب البيانات بنجاح.", corsHeaders);
      }

      if (route === "/api/events" && request.method === "POST") {
        await authorize(request, env);
        await ensureDatabase(env);
        const body = await readJsonBody(request);
        const saved = await saveEvent(env.DB, body.data || body, false);
        return success(saved, "تمت إضافة الفعالية بنجاح.", corsHeaders, 201);
      }

      const eventMatch = route.match(/^\/api\/events\/(\d+)$/);
      if (eventMatch && request.method === "PUT") {
        await authorize(request, env);
        await ensureDatabase(env);
        const body = await readJsonBody(request);
        const saved = await saveEvent(
          env.DB,
          { ...(body.data || body), id: Number(eventMatch[1]) },
          true,
        );
        return success(saved, "تم تعديل الفعالية بنجاح.", corsHeaders);
      }

      if (eventMatch && request.method === "DELETE") {
        await authorize(request, env);
        await ensureDatabase(env);
        const deleted = await deleteEvent(env.DB, Number(eventMatch[1]));
        return success({ deleted }, "تم حذف الفعالية بنجاح.", corsHeaders);
      }

      if (route === "/api/sync" && request.method === "POST") {
        await authorize(request, env);
        await ensureDatabase(env);
        const body = await readJsonBody(request);
        const events = Array.isArray(body.events) ? body.events : null;
        if (!events) throw new ApiError(400, "events يجب أن تكون قائمة بيانات.");
        const synced = await syncEvents(env.DB, events);
        return success(synced, "تمت مزامنة البيانات بنجاح.", corsHeaders);
      }

      throw new ApiError(404, "المسار المطلوب غير موجود.");
    } catch (error) {
      return errorResponse(error, corsHeaders);
    }
  },
};

async function handleAction(action, payload, request, env, corsHeaders) {
  if (action === "ping") {
    return success(
      {
        version: env.APP_VERSION || DEFAULT_VERSION,
        connected: true,
        databaseConfigured: Boolean(env.DB),
      },
      "الاتصال يعمل بنجاح.",
      corsHeaders,
    );
  }

  await authorize(request, env, payload);
  await ensureDatabase(env);

  switch (action) {
    case "get_events":
      return success(await getEvents(env.DB), "تم جلب البيانات بنجاح.", corsHeaders);

    case "sync_events": {
      if (!Array.isArray(payload.events)) {
        throw new ApiError(400, "events يجب أن تكون قائمة بيانات.");
      }
      const events = await syncEvents(env.DB, payload.events);
      return success(events, "تمت مزامنة البيانات بنجاح.", corsHeaders);
    }

    case "add_event": {
      if (!payload.data) throw new ApiError(400, "بيانات الفعالية غير موجودة.");
      const saved = await saveEvent(env.DB, payload.data, false);
      return success(saved, "تمت إضافة الفعالية بنجاح.", corsHeaders, 201);
    }

    case "edit_event": {
      if (!payload.data) throw new ApiError(400, "بيانات الفعالية غير موجودة.");
      const data = { ...payload.data };
      if (payload.id && !data.id) data.id = payload.id;
      const saved = await saveEvent(env.DB, data, true);
      return success(saved, "تم تعديل الفعالية بنجاح.", corsHeaders);
    }

    case "delete_event": {
      if (!payload.id) throw new ApiError(400, "معرّف الفعالية غير موجود.");
      const deleted = await deleteEvent(env.DB, Number(payload.id));
      return success({ deleted }, "تم حذف الفعالية بنجاح.", corsHeaders);
    }

    default:
      throw new ApiError(400, `الإجراء غير معروف: ${String(action || "فارغ")}`);
  }
}

async function ensureDatabase(env) {
  if (!env.DB) {
    throw new ApiError(
      503,
      "قاعدة البيانات غير مربوطة بعد. أضف D1 binding باسم DB من إعدادات Cloudflare Worker.",
    );
  }

  if (!schemaReady) {
    schemaReady = env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          center_name TEXT NOT NULL,
          event_name TEXT NOT NULL,
          event_type TEXT NOT NULL,
          event_date TEXT NOT NULL,
          village_name TEXT NOT NULL,
          beneficiaries_count INTEGER NOT NULL DEFAULT 0 CHECK (beneficiaries_count >= 0),
          cost REAL NOT NULL DEFAULT 0 CHECK (cost >= 0),
          coordinator_name TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          last_updated INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )
      `),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_events_center ON events(center_name)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_events_updated ON events(last_updated DESC)"),
    ]).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  await schemaReady;
}

async function getEvents(db) {
  const result = await db
    .prepare(`
      SELECT id, center_name, event_name, event_type, event_date, village_name,
             beneficiaries_count, cost, coordinator_name, status, notes, last_updated
      FROM events
      ORDER BY id DESC
    `)
    .all();

  return (result.results || []).map(rowToEvent);
}

async function syncEvents(db, inputEvents) {
  if (inputEvents.length > MAX_SYNC_EVENTS) {
    throw new ApiError(413, `الحد الأقصى للمزامنة الواحدة هو ${MAX_SYNC_EVENTS} فعالية.`);
  }

  const normalized = inputEvents.map((event) => normalizeEvent(event, { requireId: true }));
  if (normalized.length) {
    const statements = normalized.map((event) => upsertStatement(db, event));
    await db.batch(statements);
  }

  return getEvents(db);
}

async function saveEvent(db, input, requireExisting) {
  let event = normalizeEvent(input, { requireId: requireExisting });

  if (requireExisting) {
    const exists = await db.prepare("SELECT id FROM events WHERE id = ?1").bind(event.id).first();
    if (!exists) throw new ApiError(404, `لم يتم العثور على الفعالية رقم ${event.id}.`);
  }

  if (event.id > 0) {
    await upsertStatement(db, event).run();
    return event;
  }

  const now = Date.now();
  const result = await db
    .prepare(`
      INSERT INTO events (
        center_name, event_name, event_type, event_date, village_name,
        beneficiaries_count, cost, coordinator_name, status, notes,
        last_updated, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
    `)
    .bind(
      event.centerName,
      event.eventName,
      event.eventType,
      event.eventDate,
      event.villageName,
      event.beneficiariesCount,
      event.cost,
      event.coordinatorName,
      event.status,
      event.notes,
      event.lastUpdated,
      now,
    )
    .run();

  event = { ...event, id: Number(result.meta?.last_row_id || 0) };
  if (!event.id) throw new ApiError(500, "تم الحفظ لكن تعذر قراءة معرّف الفعالية الجديدة.");
  return event;
}

function upsertStatement(db, event) {
  const now = Date.now();
  return db
    .prepare(`
      INSERT INTO events (
        id, center_name, event_name, event_type, event_date, village_name,
        beneficiaries_count, cost, coordinator_name, status, notes,
        last_updated, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
      ON CONFLICT(id) DO UPDATE SET
        center_name = excluded.center_name,
        event_name = excluded.event_name,
        event_type = excluded.event_type,
        event_date = excluded.event_date,
        village_name = excluded.village_name,
        beneficiaries_count = excluded.beneficiaries_count,
        cost = excluded.cost,
        coordinator_name = excluded.coordinator_name,
        status = excluded.status,
        notes = excluded.notes,
        last_updated = excluded.last_updated
    `)
    .bind(
      event.id,
      event.centerName,
      event.eventName,
      event.eventType,
      event.eventDate,
      event.villageName,
      event.beneficiariesCount,
      event.cost,
      event.coordinatorName,
      event.status,
      event.notes,
      event.lastUpdated,
      now,
    );
}

async function deleteEvent(db, id) {
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "معرّف الفعالية غير صالح.");
  const result = await db.prepare("DELETE FROM events WHERE id = ?1").bind(id).run();
  return Number(result.meta?.changes || 0) > 0;
}

function normalizeEvent(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError(400, "بيانات الفعالية غير صالحة.");
  }

  const id = Number(input.id || 0);
  if ((options.requireId || id) && (!Number.isInteger(id) || id <= 0)) {
    throw new ApiError(400, "معرّف الفعالية غير صالح.");
  }

  const centerName = safeText(input.centerName);
  if (!centerName) throw new ApiError(400, "اسم المركز مطلوب.");
  if (!CENTERS.includes(centerName)) {
    throw new ApiError(400, `اسم المركز غير معتمد: ${centerName}`);
  }

  const event = {
    id,
    centerName,
    eventName: safeText(input.eventName),
    eventType: safeText(input.eventType),
    eventDate: safeText(input.eventDate),
    villageName: safeText(input.villageName),
    beneficiariesCount: Number(input.beneficiariesCount || 0),
    cost: Number(input.cost || 0),
    coordinatorName: safeText(input.coordinatorName),
    status: safeText(input.status),
    notes: safeText(input.notes),
    lastUpdated: Number(input.lastUpdated || Date.now()),
  };

  if (!event.eventName) throw new ApiError(400, "اسم الفعالية مطلوب.");
  if (!event.eventType) throw new ApiError(400, "نوع الفعالية مطلوب.");
  if (!event.eventDate) throw new ApiError(400, "تاريخ الفعالية مطلوب.");
  if (!event.villageName) throw new ApiError(400, "اسم القرية مطلوب.");
  if (!Number.isFinite(event.beneficiariesCount) || event.beneficiariesCount < 0) {
    throw new ApiError(400, "عدد المستفيدين غير صالح.");
  }
  if (!Number.isFinite(event.cost) || event.cost < 0) {
    throw new ApiError(400, "التكلفة غير صالحة.");
  }
  if (!Number.isFinite(event.lastUpdated) || event.lastUpdated <= 0) {
    event.lastUpdated = Date.now();
  }

  return event;
}

function rowToEvent(row) {
  return {
    id: Number(row.id),
    centerName: String(row.center_name || ""),
    eventName: String(row.event_name || ""),
    eventType: String(row.event_type || ""),
    eventDate: String(row.event_date || ""),
    villageName: String(row.village_name || ""),
    beneficiariesCount: Number(row.beneficiaries_count || 0),
    cost: Number(row.cost || 0),
    coordinatorName: String(row.coordinator_name || ""),
    status: String(row.status || ""),
    notes: String(row.notes || ""),
    lastUpdated: Number(row.last_updated || Date.now()),
  };
}

async function authorize(request, env, payload = {}) {
  if (!env.API_KEY) return;

  const headerKey = request.headers.get("x-api-key") || "";
  const auth = request.headers.get("authorization") || "";
  const bearerKey = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const bodyKey = typeof payload.apiKey === "string" ? payload.apiKey : "";
  const supplied = headerKey || bearerKey || bodyKey;

  if (!supplied || !timingSafeEqual(supplied, env.API_KEY)) {
    throw new ApiError(401, "مفتاح الوصول غير صحيح أو غير موجود.");
  }
}

function timingSafeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function readJsonBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiError(415, "نوع المحتوى يجب أن يكون application/json.");
  }

  const text = await request.text();
  if (!text.trim()) throw new ApiError(400, "جسم الطلب غير موجود.");

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "جسم الطلب ليس JSON صالحًا.");
  }
}

function normalizeAction(action) {
  const map = {
    getEvents: "get_events",
    syncEvents: "sync_events",
    addEvent: "add_event",
    editEvent: "edit_event",
    deleteEvent: "delete_event",
  };
  const value = String(action || "").trim();
  return map[value] || value || "ping";
}

function normalizeRoute(pathname) {
  const clean = pathname.replace(/\/+$/, "");
  return clean || "/";
}

function safeText(value) {
  const text = String(value ?? "").trim();
  return text.replace(/^[=+\-@]+/, "").trim().slice(0, 5000);
}

function buildCorsHeaders(request, env) {
  const requestOrigin = request.headers.get("origin") || "";
  const configuredOrigin = env.ALLOWED_ORIGIN || "*";
  const allowedOrigin = configuredOrigin === "*" ? "*" : requestOrigin === configuredOrigin ? requestOrigin : configuredOrigin;

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function success(data, message, corsHeaders, statusCode = 200) {
  return jsonResponse(
    {
      success: true,
      status: "success",
      message: message || "تمت العملية بنجاح.",
      data,
      timestamp: new Date().toISOString(),
    },
    statusCode,
    corsHeaders,
  );
}

function errorResponse(error, corsHeaders) {
  const statusCode = error instanceof ApiError ? error.statusCode : 500;
  const message = error instanceof ApiError ? error.message : "حدث خطأ داخلي غير متوقع.";

  if (!(error instanceof ApiError)) console.error(error);

  return jsonResponse(
    {
      success: false,
      status: "error",
      message,
      data: null,
      timestamp: new Date().toISOString(),
    },
    statusCode,
    corsHeaders,
  );
}

function jsonResponse(payload, statusCode, corsHeaders) {
  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders,
    },
  });
}

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
  }
}
