const db = window.supabase.createClient(
  window.APP_CONFIG.SUPABASE_URL,
  window.APP_CONFIG.SUPABASE_KEY
);

async function login(e) {
  e.preventDefault();

  const email    = document.getElementById("usuario").value.trim();
  const password = document.getElementById("password").value;
  const errorEl  = document.getElementById("error");
  const btn      = document.getElementById("btn-ingresar");

  errorEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Ingresando...";

  const { error } = await db.auth.signInWithPassword({ email, password });

  if (error) {
    errorEl.textContent = "Usuario o contraseña incorrectos";
    document.getElementById("password").value = "";
    document.getElementById("password").focus();
    btn.disabled = false;
    btn.textContent = "Ingresar";
    return;
  }

  window.location.href = "admin.html";
}
