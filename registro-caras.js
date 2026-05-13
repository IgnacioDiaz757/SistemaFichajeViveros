const SUPABASE_URL = window.APP_CONFIG.SUPABASE_URL;
const SUPABASE_KEY = window.APP_CONFIG.SUPABASE_KEY;
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const MODEL_URL = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights";

let stream               = null;
let descriptoresCapturados = [];
let modelsLoaded         = false;

// ── Modelos ───────────────────────────────────────────────

async function cargarModelos() {
  if (modelsLoaded) return;
  setEstado("Cargando modelos de reconocimiento facial (primera vez puede tardar)...");
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);
  modelsLoaded = true;
  setEstado("");
}

// ── Empleados ─────────────────────────────────────────────

async function cargarEmpleados() {
  const { data, error } = await db
    .from("empleados")
    .select("id, nombre, puesto, obra, contratista, created_at")
    .order("nombre");

  const lista = document.getElementById("lista-asociados");
  const badge = document.getElementById("badge-count");

  if (error || !data) {
    lista.innerHTML = '<div class="empty-state"><p style="color:#dc2626">Error al cargar asociados.</p></div>';
    return;
  }
  if (!data.length) {
    if (badge) badge.textContent = "0";
    lista.innerHTML = '<div class="empty-state"><p>Sin asociados registrados aún.</p></div>';
    return;
  }

  if (badge) badge.textContent = data.length;

  lista.innerHTML = data.map(e => {
    const iniciales = e.nombre.split(" ").slice(0, 2).map(w => w[0] || "").join("").toUpperCase() || "?";
    const sub       = [e.puesto, e.obra, e.contratista].filter(Boolean).join(" · ");
    const obraEsc   = (e.obra || "").replace(/'/g, "\\'");
    const badges    = [e.puesto, e.obra, e.contratista].filter(Boolean)
                        .map(v => `<span class="emp-badge">${v}</span>`).join("");
    return `
    <div class="empleado-item" id="emp-item-${e.id}">
      <div class="emp-avatar">${iniciales}</div>
      <div class="emp-body">
        <span class="empleado-nombre">${e.nombre}</span>
        <span id="emp-sub-${e.id}" style="display:block;font-size:12px;color:var(--text-muted);margin-top:2px">${sub || "Sin obra asignada"}</span>
        ${badges ? `<div class="emp-badges">${badges}</div>` : ""}
        <div id="emp-edit-${e.id}" class="emp-edit-panel" style="display:none;gap:7px;align-items:center;flex-wrap:wrap">
          <select id="emp-sel-${e.id}"><option value="">— Sin obra —</option></select>
          <button onclick="guardarObraEmpleado('${e.id}')" class="btn-save-obra">Guardar</button>
          <button onclick="cancelarEditarObra('${e.id}')" class="btn-cancel-obra">Cancelar</button>
        </div>
      </div>
      <div class="emp-actions">
        <button class="btn-edit-obra btn-azul btn" onclick="abrirEditarObra('${e.id}', '${obraEsc}')">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Obra
        </button>
        <button class="btn-del" onclick="eliminarEmpleado('${e.id}', '${e.nombre.replace(/'/g, "\\'")}')">✕</button>
      </div>
    </div>`;
  }).join("");
}

async function eliminarEmpleado(id, nombre) {
  if (!confirm(`¿Eliminar el reconocimiento facial de "${nombre}"?\n\nEl empleado dejará de ser reconocido automáticamente.`)) return;
  const { error } = await db.from("empleados").delete().eq("id", id);
  if (error) { alert("Error al eliminar."); return; }
  cargarEmpleados();
}

async function abrirEditarObra(id, obraActual) {
  const editDiv = document.getElementById(`emp-edit-${id}`);
  const sel     = document.getElementById(`emp-sel-${id}`);

  // Cargar obras si el select solo tiene la opción vacía
  if (sel.options.length <= 1) {
    const { data } = await db.from("obras").select("nombre").order("nombre");
    (data || []).forEach(o => {
      const opt = document.createElement("option");
      opt.value = o.nombre; opt.textContent = o.nombre;
      sel.appendChild(opt);
    });
  }

  // Seleccionar la obra actual
  for (let i = 0; i < sel.options.length; i++) {
    if (sel.options[i].value === obraActual) { sel.selectedIndex = i; break; }
  }

  editDiv.style.display = "flex";
}

function cancelarEditarObra(id) {
  document.getElementById(`emp-edit-${id}`).style.display = "none";
}

async function guardarObraEmpleado(id) {
  const sel      = document.getElementById(`emp-sel-${id}`);
  const obraNueva = sel.value || null;

  const { error } = await db.from("empleados").update({ obra: obraNueva }).eq("id", id);
  if (error) { alert("Error al guardar la obra."); return; }

  // Actualizar el subtítulo sin recargar toda la lista
  const subEl = document.getElementById(`emp-sub-${id}`);
  subEl.textContent = obraNueva || "Sin obra asignada";
  document.getElementById(`emp-edit-${id}`).style.display = "none";

  // Actualizar el onclick del botón editar con la nueva obra
  const btn = document.querySelector(`#emp-item-${id} .btn-azul`);
  if (btn) btn.setAttribute("onclick", `abrirEditarObra('${id}', '${(obraNueva || "").replace(/'/g, "\\'")}')`);
}

// ── Cámara ────────────────────────────────────────────────

async function abrirCamara() {
  const nombre = document.getElementById("inp-nombre").value.trim();
  if (!nombre) { alert("Ingresá el nombre del empleado antes de abrir la cámara."); return; }

  // getUserMedia requiere HTTPS en móviles
  const esSeguro = location.protocol === "https:" ||
                   location.hostname  === "localhost" ||
                   location.hostname  === "127.0.0.1";
  if (!esSeguro) {
    setEstado("La cámara solo funciona con HTTPS. Accedé desde el link seguro de Vercel.", "error");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setEstado("Tu navegador no soporta acceso a la cámara. Usá Chrome o Safari actualizado.", "error");
    return;
  }

  setEstado("Preparando...");
  try {
    await cargarModelos();
  } catch {
    setEstado("Error al cargar los modelos. Verificá tu conexión a internet.", "error");
    return;
  }

  // Intentar cámara frontal → si falla, cualquier cámara disponible
  let streamObj = null;
  try {
    streamObj = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
  } catch {
    try {
      streamObj = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch (err) {
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setEstado("Permiso denegado. Activá la cámara en Configuración > Permisos del navegador.", "error");
      } else if (err.name === "NotFoundError") {
        setEstado("No se encontró ninguna cámara en este dispositivo.", "error");
      } else if (err.name === "NotReadableError") {
        setEstado("La cámara está en uso por otra app. Cerrala e intentá de nuevo.", "error");
      } else {
        setEstado(`Error de cámara (${err.name}). Intentá recargar la página.`, "error");
      }
      return;
    }
  }

  stream = streamObj;
  const video = document.getElementById("reg-video");
  video.srcObject = stream;
  video.style.transform = "scaleX(-1)";
  descriptoresCapturados = [];
  actualizarProgreso();
  setIndicador("Mirá a la cámara y presioná el botón");
  setBtnCapturar(true);
  document.getElementById("camara-modal").style.display = "flex";
  setEstado("");
}

function cerrarCamara() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  document.getElementById("camara-modal").style.display = "none";
  descriptoresCapturados = [];
  actualizarProgreso();
}

async function capturarFoto() {
  const video  = document.getElementById("reg-video");
  const canvas = document.getElementById("reg-canvas");
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;

  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0);

  setBtnCapturar(false);
  setIndicador("Detectando cara...");

  try {
    const detection = await faceapi
      .detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 320 }))
      .withFaceLandmarks(true)
      .withFaceDescriptor();

    if (!detection) {
      setIndicador("No se detectó una cara. Acercate más y mirá de frente.");
      setBtnCapturar(true);
      return;
    }

    descriptoresCapturados.push(Array.from(detection.descriptor));
    actualizarProgreso();

    if (descriptoresCapturados.length >= 3) {
      setIndicador("¡Listo! Guardando...");
      await guardarEmpleado();
      cerrarCamara();
    } else {
      setIndicador(`Foto ${descriptoresCapturados.length}/3 ✓ — Girá levemente la cabeza y sacá otra.`);
      setBtnCapturar(true);
    }
  } catch {
    setIndicador("Error al procesar. Intentá de nuevo.");
    setBtnCapturar(true);
  }
}

function actualizarProgreso() {
  const n = descriptoresCapturados.length;
  for (let i = 0; i < 3; i++) {
    const dot = document.getElementById(`dot-${i}`);
    if (dot) dot.className = "dot" + (i < n ? " dot-ok" : "");
  }
}

// ── Guardar ───────────────────────────────────────────────

async function guardarEmpleado() {
  const nombre      = document.getElementById("inp-nombre").value.trim();
  const puesto      = document.getElementById("inp-puesto").value.trim() || null;
  const obra        = document.getElementById("inp-obra").value || null;
  const contratista = document.getElementById("inp-contratista").value.trim() || null;

  const { error } = await db.from("empleados").upsert(
    [{ nombre, descriptors: descriptoresCapturados, puesto, obra, contratista }],
    { onConflict: "nombre" }
  );

  if (error) {
    if (error.code === "42P01") {
      setEstado("La tabla 'empleados' no existe en Supabase. Creala con el SQL del paso de configuración.", "error");
    } else if (error.code === "42501" || error.message?.includes("policy")) {
      setEstado("Sin permisos para guardar. Revisá las políticas RLS de Supabase o deshabilitá RLS en la tabla 'empleados'.", "error");
    } else {
      setEstado(`Error al guardar: ${error.message}`, "error");
    }
    return;
  }

  document.getElementById("inp-nombre").value      = "";
  document.getElementById("inp-puesto").value       = "";
  document.getElementById("inp-obra").value         = "";
  document.getElementById("inp-contratista").value  = "";
  setEstado(`"${nombre}" registrado correctamente.`, "ok");
  setTimeout(() => setEstado(""), 4000);
  cargarEmpleados();
}

// ── Helpers ───────────────────────────────────────────────

function setEstado(msg, tipo = "") {
  const el = document.getElementById("estado");
  el.textContent = msg;
  el.className   = tipo;
}

function setIndicador(msg) {
  document.getElementById("indicador").textContent = msg;
}

function setBtnCapturar(enabled) {
  document.getElementById("btn-capturar").disabled = !enabled;
}

// ── Obras ─────────────────────────────────────────────────

async function cargarObras() {
  const { data } = await db.from("obras").select("nombre").order("nombre");
  const sel = document.getElementById("inp-obra");
  if (!data || !data.length) return;
  data.forEach(o => {
    const opt = document.createElement("option");
    opt.value = o.nombre;
    opt.textContent = o.nombre;
    sel.appendChild(opt);
  });
}

// ── Contratistas ──────────────────────────────────────────

async function cargarContratistas() {
  const { data } = await db.from("contratistas").select("nombre").order("nombre");
  const sel = document.getElementById("inp-contratista");
  if (!data || !data.length) return;
  data.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.nombre;
    opt.textContent = c.nombre;
    sel.appendChild(opt);
  });
}

// ── Init ──────────────────────────────────────────────────

(async () => {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    window.location.replace("login.html");
    return;
  }

  cargarObras();
  cargarContratistas();
})();
cargarEmpleados();
