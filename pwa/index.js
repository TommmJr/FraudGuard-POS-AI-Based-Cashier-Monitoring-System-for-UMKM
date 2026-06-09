/* Landing Page Logic - FraudGuard POS */

function loginAsOwner() {
    window.location.href = "owner/owner-dashboard.html";
}

function loginAsCashier(cashierId) {
    window.location.href = `cashier/cashier-dashboard.html?cashier_id=${cashierId}`;
}

// REGISTER SERVICE WORKER
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker terdaftar di PWA!', reg))
            .catch(err => console.log('Service Worker gagal terdaftar!', err));
    });
}
