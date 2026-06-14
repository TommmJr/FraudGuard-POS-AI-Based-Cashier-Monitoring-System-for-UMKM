/* Shared Javascript Utilities for FraudGuard POS */

let API_BASE_URL = `http://${window.location.hostname}:5000/api`;
if (window.location.hostname === "" || window.location.protocol === "file:") {
    API_BASE_URL = "http://127.0.0.1:5000/api";
}

// Auto-detect remote IDE environments (Codespaces / Gitpod / VSCode Tunnels)
if (window.location.hostname.includes("github.dev") || window.location.hostname.includes("gitpod.io") || window.location.hostname.includes("app.github.dev")) {
    let portMatch = window.location.hostname.match(/-(\d+)\./);
    if (portMatch) {
        let frontendPort = portMatch[1];
        let backendHost = window.location.hostname.replace(`-${frontendPort}.`, `-5000.`);
        API_BASE_URL = `https://${backendHost}/api`;
    }
}

let activeDB = null;

//  TOAST NOTIFICATIONS HELPER 
function triggerToast(title, message, type = "info") {
    let container = document.getElementById("toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;

    let iconClass = "fa-solid fa-circle-info";
    if (type === "success") iconClass = "fa-solid fa-circle-check";
    if (type === "warning") iconClass = "fa-solid fa-triangle-exclamation";
    if (type === "critical") iconClass = "fa-solid fa-circle-radiation";

    toast.innerHTML = `
        <div class="toast-icon"><i class="${iconClass}"></i></div>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-msg">${message}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()"><i class="fa-solid fa-xmark"></i></button>
    `;

    container.appendChild(toast);

    // Auto remove after 5 seconds
    setTimeout(() => {
        toast.style.animation = "slideIn 0.3s ease reverse";
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

//  INDEXEDDB UTIL (OFFLINE-FIRST) 
function initIndexedDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open("fraudguard_local", 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            const store = db.createObjectStore("transactions", { keyPath: "id" });
            store.createIndex("is_synced", "is_synced", { unique: false });
        };
        req.onsuccess = () => {
            activeDB = req.result;
            resolve(activeDB);
        };
        req.onerror = () => {
            console.error("IndexedDB initialization blocked", req.error);
            reject(req.error);
        };
    });
}

// Save transaction record to Local DB cache
async function saveLocalTransaction(txn) {
    if (!activeDB) await initIndexedDB();
    return new Promise((resolve, reject) => {
        const tx = activeDB.transaction("transactions", "readwrite");
        const store = tx.objectStore("transactions");
        const req = store.put(txn);
        req.onsuccess = () => resolve(txn);
        req.onerror = () => reject(req.error);
    });
}

// Fetch all transaction records cached locally
async function getCachedTransactions() {
    if (!activeDB) await initIndexedDB();
    return new Promise((resolve) => {
        const tx = activeDB.transaction("transactions", "readonly");
        const store = tx.objectStore("transactions");
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
    });
}

//  CURRENCY FORMATTER 
function formatCurrencyRupiah(amount) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0
    }).format(amount);
}

// Delete a single transaction record from IndexedDB by its id
async function deleteLocalTransaction(txId) {
    if (!activeDB) await initIndexedDB();
    return new Promise((resolve, reject) => {
        const tx = activeDB.transaction("transactions", "readwrite");
        const store = tx.objectStore("transactions");
        const req = store.delete(txId);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
    });
}