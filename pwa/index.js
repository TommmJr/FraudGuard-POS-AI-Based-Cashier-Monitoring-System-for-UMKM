/* Landing Page Logic - FraudGuard POS */

//  CREDENTIALS (Static for Capstone Demo)
const CREDENTIALS = {
    "owner": {
        password: "owner123",
        role: "owner",
        name: "Owner Panel",
        redirect: "owner/owner-dashboard.html"
    },
    "kasir1": {
        password: "kasir001",
        role: "cashier",
        name: "CSH-001 – Kasir Utama Shift Pagi",
        cashierId: "CSH-001",
        redirect: "cashier/cashier-dashboard.html?cashier_id=CSH-001"
    },
    "kasir2": {
        password: "kasir002",
        role: "cashier",
        name: "CSH-002 – Kasir Shift Pagi",
        cashierId: "CSH-002",
        redirect: "cashier/cashier-dashboard.html?cashier_id=CSH-002"
    },
    "kasir3": {
        password: "kasir003",
        role: "cashier",
        name: "CSH-003 – Kasir Shift Siang",
        cashierId: "CSH-003",
        redirect: "cashier/cashier-dashboard.html?cashier_id=CSH-003"
    },
    "kasir4": {
        password: "kasir004",
        role: "cashier",
        name: "CSH-004 – Kasir Shift Malam",
        cashierId: "CSH-004",
        redirect: "cashier/cashier-dashboard.html?cashier_id=CSH-004"
    },
    "kasir5": {
        password: "kasir005",
        role: "cashier",
        name: "CSH-005 – Kasir Magang Shift Malam",
        cashierId: "CSH-005",
        redirect: "cashier/cashier-dashboard.html?cashier_id=CSH-005"
    }
};

let _pendingRedirect = null;

//  OPEN LOGIN MODAL
function openLoginModal(username) {
    _pendingRedirect = CREDENTIALS[username] || null;
    if (!_pendingRedirect) return;

    document.getElementById("login-modal-title").textContent = _pendingRedirect.name;
    document.getElementById("login-username-field").value = username;
    document.getElementById("login-password-field").value = "";
    document.getElementById("login-error-msg").style.display = "none";
    document.getElementById("login-modal").style.display = "flex";
    setTimeout(() => document.getElementById("login-password-field").focus(), 80);
}

function closeLoginModal() {
    document.getElementById("login-modal").style.display = "none";
    document.getElementById("login-password-field").value = "";
    document.getElementById("login-error-msg").style.display = "none";
    _pendingRedirect = null;
}

//  SUBMIT LOGIN
function submitLogin(e) {
    if (e) e.preventDefault();
    const username = document.getElementById("login-username-field").value.trim();
    const password = document.getElementById("login-password-field").value;
    const errEl = document.getElementById("login-error-msg");
    const btn = document.getElementById("login-submit-btn");

    const account = CREDENTIALS[username];
    if (!account || account.password !== password) {
        const errSpan = errEl.querySelector("span");
        if (errSpan) errSpan.textContent = "Username atau password salah. Coba lagi.";
        errEl.style.display = "block";
        document.getElementById("login-password-field").value = "";
        document.getElementById("login-password-field").focus();
        // Shake animation
        const modalBox = document.querySelector("#login-modal .login-modal-box");
        if (modalBox) {
            modalBox.style.animation = "none";
            setTimeout(() => modalBox.style.animation = "shakeModal 0.4s ease", 10);
        }
        return;
    }

    // Credentials correct — redirect
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Masuk...';
    btn.disabled = true;
    errEl.style.display = "none";
    setTimeout(() => { window.location.href = account.redirect; }, 500);
}

// Close modal on overlay click
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("login-modal").addEventListener("click", function (e) {
        if (e.target === this) closeLoginModal();
    });
    // Enter key on password field submits
    document.getElementById("login-password-field").addEventListener("keydown", function (e) {
        if (e.key === "Enter") submitLogin(null);
    });
});


//  LEGACY HELPERS (kept for onclick compatibility)
function loginAsOwner() { openLoginModal("owner"); }
function loginAsCashier(cashierId) {
    const key = "kasir" + cashierId.replace("CSH-00", "");
    openLoginModal(key);
}

//  REGISTER SERVICE WORKER
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker terdaftar di PWA!', reg))
            .catch(err => console.log('Service Worker gagal terdaftar!', err));
    });
}
