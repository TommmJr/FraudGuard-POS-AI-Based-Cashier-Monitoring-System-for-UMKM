/* Cashier Dashboard Logic - FraudGuard POS */

let loggedInCashierId = "CSH-001";
let cashierActivityChart = null;

//  CLOCK AND CASHER IDENTIFICATION 
function updateRealtimeClock() {
    const clockSpan = document.getElementById("clock").querySelector("span");
    const timeNow = new Date();
    clockSpan.textContent = timeNow.toTimeString().split(' ')[0];
}
setInterval(updateRealtimeClock, 1000);
updateRealtimeClock();

// Extract Cashier ID from URL parameter e.g. ?cashier_id=CSH-005
function parseCashierSession() {
    const params = new URLSearchParams(window.location.search);
    const cashierIdParam = params.get("cashier_id");
    if (cashierIdParam) {
        loggedInCashierId = cashierIdParam;
    }

    // Set UI elements
    document.getElementById("input-cashier").value = loggedInCashierId;
    document.getElementById("session-cashier").textContent = loggedInCashierId;
    document.getElementById("avatar-initials").textContent = loggedInCashierId.substring(0, 2).toUpperCase();
}

//  NETWORK STATE & CARD BADGES 
function refreshNetworkStatus(isOnline) {
    const badge = document.getElementById("status-network");
    const badgeText = badge.querySelector("span");
    const syncStatusCard = document.getElementById("card-sync-status");
    const syncCardIcon = document.getElementById("card-sync-icon");

    if (isOnline) {
        badge.className = "status-badge online";
        badgeText.textContent = "Online";
        syncStatusCard.textContent = "Synced";
        syncCardIcon.style.color = "var(--risk-low)";
    } else {
        badge.className = "status-badge offline";
        badgeText.textContent = "Offline";
        syncStatusCard.textContent = "Pending (Local)";
        syncCardIcon.style.color = "var(--risk-medium)";
    }
}

//  SYNC & SCORE DATA 
async function syncLocalTransactions() {
    if (!navigator.onLine) {
        refreshNetworkStatus(false);
        return;
    }

    try {
        const txs = await getCachedTransactions();
        const unsynced = txs.filter(t => t.is_synced === 0);

        if (unsynced.length === 0) {
            refreshNetworkStatus(true);
            return;
        }

        triggerToast("Sync Pending", `Uploading ${unsynced.length} transactions to server...`, "info");

        // POST to Flask transactions endpoint
        const resSave = await fetch(`${API_BASE_URL}/transactions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transactions: unsynced })
        });

        if (resSave.ok) {
            // Trigger batch score
            const resScore = await fetch(`${API_BASE_URL}/batch-score`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({})
            });
            const scoreRes = await resScore.json();

            if (scoreRes.status === "success") {
                // Update local status inside IndexedDB
                for (let record of unsynced) {
                    record.is_synced = 1;
                    await saveLocalTransaction(record);
                }

                triggerToast("Sync Success", `Synced & scored ${scoreRes.scored_count} transactions`, "success");

                // Print AI Alert toasts
                if (scoreRes.review && scoreRes.review.flags) {
                    scoreRes.review.flags.forEach(f => {
                        if (f.action === "REQUEST_AUTHORIZATION") {
                            triggerToast("[AI ALERT] Perlu Tinjauan", `${f.message} (Score: ${f.fraud_score})`, "critical");
                        } else if (f.action === "NOTIFY_FOR_REVIEW") {
                            triggerToast("[AI ALERT] Perhatian", `${f.message} (Score: ${f.fraud_score})`, "warning");
                        }
                    });
                }
            }
        }
        refreshNetworkStatus(true);
    } catch (err) {
        console.error("Autosync failed:", err);
        refreshNetworkStatus(false);
    }
}

//  RE-CALCULATE METRICS & RENDER VIEWS 
function updateKpiStats(transactions) {
    const todayStr = new Date().toISOString().split('T')[0];
    const todayTxs = transactions.filter(t => t.cashier_id === loggedInCashierId && t.timestamp.startsWith(todayStr));

    const count = todayTxs.length;
    const sales = todayTxs.filter(t => t.transaction_type === "SALE").reduce((sum, t) => sum + parseFloat(t.amount), 0);
    const refunds = todayTxs.filter(t => t.transaction_type === "REFUND").reduce((sum, t) => sum + parseFloat(t.amount), 0);

    // AI Counter Stats
    const pending = todayTxs.filter(t => !t.risk_level).length;
    const low = todayTxs.filter(t => t.risk_level === "LOW").length;
    const med = todayTxs.filter(t => t.risk_level === "MEDIUM").length;
    const high = todayTxs.filter(t => t.risk_level === "HIGH").length;
    const crit = todayTxs.filter(t => t.risk_level === "CRITICAL").length;

    // Set UI cards
    document.getElementById("card-tx-count").textContent = count;
    document.getElementById("card-sale-amount").textContent = formatCurrencyRupiah(sales);
    document.getElementById("card-refund-amount").textContent = formatCurrencyRupiah(refunds);

    document.getElementById("ai-count-pending").textContent = pending;
    document.getElementById("ai-count-low").textContent = low;
    document.getElementById("ai-count-medium").textContent = med;
    document.getElementById("ai-count-high").textContent = high;
    document.getElementById("ai-count-critical").textContent = crit;

    // Redraw graphs
    renderHourActivityGraph(todayTxs);
}

function renderHourActivityGraph(todayTxs) {
    const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
    const saleCounts = Array(24).fill(0);
    const refundCounts = Array(24).fill(0);

    todayTxs.forEach(t => {
        const hr = new Date(t.timestamp).getHours();
        if (t.transaction_type === "SALE") saleCounts[hr]++;
        else if (t.transaction_type === "REFUND") refundCounts[hr]++;
    });

    const displayLabels = hours.slice(7, 22);
    const displaySales = saleCounts.slice(7, 22);
    const displayRefunds = refundCounts.slice(7, 22);

    if (cashierActivityChart) {
        cashierActivityChart.data.labels = displayLabels;
        cashierActivityChart.data.datasets[0].data = displaySales;
        cashierActivityChart.data.datasets[1].data = displayRefunds;
        cashierActivityChart.update();
    } else {
        const ctx = document.getElementById('cashierActivityChart').getContext('2d');
        cashierActivityChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: displayLabels,
                datasets: [
                    {
                        label: 'SALE',
                        data: displaySales,
                        borderColor: '#2563EB',
                        backgroundColor: 'rgba(37, 99, 235, 0.1)',
                        borderWidth: 2,
                        tension: 0.35,
                        fill: true
                    },
                    {
                        label: 'REFUND',
                        data: displayRefunds,
                        borderColor: '#F59E0B',
                        backgroundColor: 'rgba(245, 158, 11, 0.05)',
                        borderWidth: 1.5,
                        tension: 0.3,
                        borderDash: [4, 4]
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 10, font: { size: 10 } } } },
                scales: {
                    y: { beginAtZero: true, grid: { color: '#E2E8F0' }, ticks: { stepSize: 1, font: { size: 9 } } },
                    x: { grid: { display: false }, ticks: { font: { size: 9 } } }
                }
            }
        });
    }
}

async function renderDashboardView() {
    let txs = [];

    try {
        const res = await fetch(`${API_BASE_URL}/transactions?cashier_id=${loggedInCashierId}&per_page=50&sort=desc`);
        if (res.ok) {
            const data = await res.json();
            txs = data.transactions;

            // Back up locally
            for (let record of txs) {
                record.is_synced = 1;
                await saveLocalTransaction(record);
            }
            refreshNetworkStatus(true);
        } else {
            txs = await getCachedTransactions();
        }
    } catch (err) {
        console.warn("Backend offline, loading data locally from IndexedDB.");
        txs = await getCachedTransactions();
        refreshNetworkStatus(false);
    }

    // Populate mock data if empty
    if (txs.length === 0) {
        txs = generateCashierMockData();
        for (let record of txs) {
            await saveLocalTransaction(record);
        }
    }

    // Update table lists
    const tableBody = document.getElementById("body-riwayat-transaksi");
    tableBody.innerHTML = "";

    const sorted = [...txs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    sorted.slice(0, 10).forEach(t => {
        const tr = document.createElement("tr");
        if (t.risk_level === "CRITICAL") tr.className = "flagged-review need_authorization";
        else if (t.risk_level === "HIGH") tr.className = "flagged-review notify";

        const risk = t.risk_level || "PENDING";
        const badgeClass = `risk-${risk.toLowerCase()}`;

        tr.innerHTML = `
            <td><code>${t.id.substring(0, 8)}...</code></td>
            <td><strong>${t.cashier_id}</strong></td>
            <td><span class="badge ${t.transaction_type.toLowerCase()}">${t.transaction_type}</span></td>
            <td><strong>${formatCurrencyRupiah(t.amount)}</strong></td>
            <td><span class="badge ${badgeClass}">${risk}</span></td>
            <td class="text-muted">${new Date(t.timestamp).toLocaleTimeString('id-ID')}</td>
        `;
        tableBody.appendChild(tr);
    });

    updateKpiStats(txs);
}

function generateCashierMockData() {
    const dummy = [];
    const types = ["SALE", "SALE", "SALE", "SALE", "REFUND", "SALE", "SALE"];
    const base = new Date();
    base.setHours(7, 0, 0, 0);

    for (let i = 0; i < 15; i++) {
        const type = types[i % types.length];
        const amt = type === "REFUND" ? [75000, 120000, 450000][i % 3] : Math.floor(Math.random() * 8 + 1) * 25000;

        let risk = "LOW";
        if (type === "REFUND" && amt > 400000) risk = "CRITICAL";
        else if (type === "REFUND" && amt > 100000) risk = "HIGH";
        else if (amt > 150000) risk = "MEDIUM";

        const txTime = new Date(base.getTime() + (i * 50 * 60000));
        if (txTime > new Date()) continue;

        dummy.push({
            id: crypto.randomUUID(),
            cashier_id: loggedInCashierId,
            timestamp: txTime.toISOString(),
            transaction_type: type,
            amount: amt,
            risk_level: risk,
            is_synced: 1
        });
    }
    return dummy;
}

//  SUBMIT TRANSACTION FORM 
document.getElementById("form-transaksi").addEventListener("submit", async function (e) {
    e.preventDefault();

    // Check if this cashier has been deactivated by Owner
    if (isCashierDeactivated()) {
        triggerToast(
            "Akses Ditolak",
            `Kasir ${loggedInCashierId} telah dinonaktifkan oleh Owner. Hubungi Owner untuk mengaktifkan kembali.`,
            "critical"
        );
        return;
    }

    const amountInput = parseFloat(document.getElementById("input-amount").value);
    const typeInput = document.getElementById("input-type").value;

    // Block REFUND specifically if deactivated (redundant but explicit)
    if (typeInput === "REFUND" && isCashierDeactivated()) {
        triggerToast("REFUND Diblokir", `Kasir ${loggedInCashierId} tidak diizinkan melakukan REFUND.`, "critical");
        return;
    }

    const newTx = {
        id: crypto.randomUUID(),
        cashier_id: loggedInCashierId,
        timestamp: new Date().toISOString(),
        transaction_type: typeInput,
        amount: amountInput,
        risk_level: null, // Scored on backend
        is_synced: 0
    };

    try {
        await saveLocalTransaction(newTx);
        triggerToast("Saved Offline", `Transaction cached in browser IndexedDB.`, "success");
        document.getElementById("input-amount").value = "";

        await syncLocalTransactions();
        await renderDashboardView();
    } catch (err) {
        console.error("Form submit save failed", err);
        triggerToast("Save Failed", "Failed to cache transaction locally.", "critical");
    }
});

//  INITIALIZE BINDINGS 
window.addEventListener("online", () => {
    triggerToast("Online Mode", "Reconnected! Synchronizing transactions with server...", "success");
    syncLocalTransactions().then(renderDashboardView);
});

window.addEventListener("offline", () => {
    triggerToast("Offline Mode", "Network disconnected. Storing transactions locally.", "warning");
    refreshNetworkStatus(false);
});

// 
//  DEACTIVATION ENFORCEMENT (set by Owner panel)
// 

function isCashierDeactivated() {
    try {
        const list = JSON.parse(localStorage.getItem("fg_deactivated_cashiers") || "[]");
        return list.includes(loggedInCashierId);
    } catch { return false; }
}

function checkDeactivationBanner() {
    let banner = document.getElementById("deactivation-banner");
    if (isCashierDeactivated()) {
        if (!banner) {
            banner = document.createElement("div");
            banner.id = "deactivation-banner";
            banner.style.cssText = `
                position: fixed; top: 0; left: 0; right: 0; z-index: 999;
                background: linear-gradient(135deg, #7F1D1D, #DC2626);
                color: white; padding: 14px 24px;
                display: flex; align-items: center; gap: 14px;
                font-size: 14px; font-weight: 600;
                box-shadow: 0 4px 20px rgba(220,38,38,0.4);
                animation: slideDown 0.4s ease;
            `;
            banner.innerHTML = `
                <i class="fa-solid fa-user-slash" style="font-size:20px;"></i>
                <span><strong>AKSES DINONAKTIFKAN OLEH OWNER</strong> — Kasir ${loggedInCashierId} tidak dapat melakukan transaksi REFUND atau menyimpan transaksi baru. Hubungi Owner untuk mengaktifkan kembali.</span>
            `;
            document.body.prepend(banner);
            // Push main content down
            document.querySelector("main") && (document.querySelector("main").style.marginTop = "60px");
        }
    } else {
        if (banner) {
            banner.remove();
            document.querySelector("main") && (document.querySelector("main").style.marginTop = "");
        }
    }
}

// Listen for real-time deactivation changes from Owner (cross-tab via localStorage)
window.addEventListener("storage", function (e) {
    if (e.key === "fg_deactivation_updated") {
        checkDeactivationBanner();
        if (isCashierDeactivated()) {
            triggerToast(
                "Status Berubah",
                `Kasir ${loggedInCashierId} telah dinonaktifkan oleh Owner.`,
                "critical"
            );
        } else {
            triggerToast(
                "Status Berubah",
                `Kasir ${loggedInCashierId} kembali aktif oleh Owner.`,
                "success"
            );
        }
    }
});


//  SIDEBAR NAVIGATION CONTROLLER 
function setupSidebarNavigation() {
    const menuItems = document.querySelectorAll(".sidebar-menu li[data-section]");
    const sections = document.querySelectorAll(".dashboard-section");

    menuItems.forEach(item => {
        const section = item.getAttribute("data-section");
        const anchor = item.querySelector("a");
        if (!anchor) return;

        // "Change Role" uses real href — leave it alone
        if (section === "profile") return;

        anchor.addEventListener("click", function (e) {
            e.preventDefault();

            // Highlight active menu item
            menuItems.forEach(li => li.classList.remove("active"));
            item.classList.add("active");

            // Hide all sections, show target
            sections.forEach(sec => {
                sec.style.display = "none";
                sec.classList.remove("active-section");
            });

            const targetEl = document.getElementById("section-" + section);
            if (targetEl) {
                targetEl.style.display = "block";
                targetEl.classList.add("active-section");
            }

            // Extra action when entering Sync Status
            if (section === "sync-status") {
                updateSyncStatusView();
            }
        });
    });

    // Manual Sync Button Binding
    const syncNowBtn = document.getElementById("sync-now-btn");
    if (syncNowBtn) {
        syncNowBtn.addEventListener("click", async () => {
            syncNowBtn.disabled = true;
            const originalHTML = syncNowBtn.innerHTML;
            syncNowBtn.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i> Menyinkronkan...';
            await syncLocalTransactions();
            await renderDashboardView();
            await updateSyncStatusView();
            syncNowBtn.innerHTML = originalHTML;
            syncNowBtn.disabled = false;
        });
    }
}

async function updateSyncStatusView() {
    try {
        const txs = await getCachedTransactions();
        const pendingCount = txs.filter(t => t.is_synced === 0).length;
        const totalCount = txs.length;

        const pendingEl = document.getElementById("sync-pending-count");
        const totalEl = document.getElementById("sync-total-count");

        if (pendingEl) pendingEl.textContent = pendingCount;
        if (totalEl) totalEl.textContent = totalCount;
    } catch (err) {
        console.error("Failed to update sync status view:", err);
    }
}

// Run Init
initIndexedDB().then(async () => {
    parseCashierSession();
    setupSidebarNavigation();
    checkDeactivationBanner();
    await syncLocalTransactions();
    await renderDashboardView();
    await updateSyncStatusView();

    // Autosync every 30 seconds
    setInterval(async () => {
        await syncLocalTransactions();
        await renderDashboardView();
        await updateSyncStatusView();
    }, 30000);
});
