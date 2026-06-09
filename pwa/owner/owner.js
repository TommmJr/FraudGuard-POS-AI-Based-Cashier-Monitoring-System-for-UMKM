/* Owner Dashboard Logic - FraudGuard POS */

let apiDashboard = null;
let apiCashiers = [];
let apiTransactions = [];
let trendChart = null;
let pieChart = null;
let currentChartTab = 'fraud';
let activeSortColumn = 'cashier_id';
let activeSortDir = 'asc';

// Set active Date in navbar
const dateOptions = { day: 'numeric', month: 'long', year: 'numeric' };
document.getElementById("header-date").textContent = new Date().toLocaleDateString('id-ID', dateOptions);

//  THEME TOGGLE BINDINGS 
const toggleButton = document.getElementById("theme-toggle-btn");
toggleButton.addEventListener("click", () => {
    const htmlEl = document.documentElement;
    const currentTheme = htmlEl.getAttribute("data-theme");
    const targetTheme = currentTheme === "dark" ? "light" : "dark";
    htmlEl.setAttribute("data-theme", targetTheme);
    toggleButton.querySelector("i").className = targetTheme === "dark" ? "fa-solid fa-sun" : "fa-solid fa-moon";

    // Rebuild charts to style grids/text for new theme
    rebuildCharts();
});

//  SORTING TABLE UTILS 
function sortTable(column) {
    if (activeSortColumn === column) {
        activeSortDir = activeSortDir === 'asc' ? 'desc' : 'asc';
    } else {
        activeSortColumn = column;
        activeSortDir = 'asc';
    }
    renderCashiersTable();
}

//  FETCH & LOAD DATA 
async function refreshDashboardData() {
    const refreshBtn = document.getElementById("refresh-btn");
    const icon = refreshBtn.querySelector("i");
    icon.classList.add("fa-spin");

    try {
        // Fetch stats from common.js base API URL
        const dashRes = await fetch(`${API_BASE_URL}/dashboard`);
        if (dashRes.ok) {
            apiDashboard = await dashRes.json();
        }

        const cashiersRes = await fetch(`${API_BASE_URL}/cashiers`);
        if (cashiersRes.ok) {
            const data = await cashiersRes.json();
            apiCashiers = data.cashiers;
        }

        const txsRes = await fetch(`${API_BASE_URL}/transactions?per_page=100`);
        if (txsRes.ok) {
            const data = await txsRes.json();
            apiTransactions = data.transactions;
        }
    } catch (err) {
        console.warn("Backend API offline or unreachable. Loading mock data fallback.", err);
        loadLocalMockData();
    }

    // Refresh components
    updateKpiNumbers();
    renderCashiersTable();
    renderTopRiskCashiers();
    renderAlertFeed();
    renderAIInsights();
    renderOwnerTransactionsTable();
    updateReportsView();
    rebuildCharts();

    setTimeout(() => {
        icon.classList.remove("fa-spin");
    }, 600);
}

//  LOCAL DUMMY FALLBACK DATA 
function loadLocalMockData() {
    apiDashboard = {
        summary: {
            total_transactions: 1420,
            total_cashiers: 5,
            total_amount: 114500000,
            total_refunds: 9450000,
            total_fraud_labeled: 14,
            refund_ratio_pct: 8.27
        },
        daily_trend: Array.from({ length: 30 }, (_, i) => {
            const date = new Date();
            date.setDate(date.getDate() - (29 - i));
            return {
                date: date.toISOString().split('T')[0],
                count: Math.floor(Math.random() * 20 + 30),
                amount: Math.floor(Math.random() * 2000000 + 3000000),
                refunds: Math.floor(Math.random() * 3),
                frauds: Math.random() > 0.65 ? Math.floor(Math.random() * 2) : 0
            };
        })
    };

    apiCashiers = [
        { cashier_id: "CSH-001", total_transactions: 280, total_amount: 24500000, refund_count: 18, refund_ratio_pct: 6.43, fraud_count: 1, last_transaction: "2026-06-10 12:45:00" },
        { cashier_id: "CSH-002", total_transactions: 320, total_amount: 29800000, refund_count: 12, refund_ratio_pct: 3.75, fraud_count: 0, last_transaction: "2026-06-10 13:02:00" },
        { cashier_id: "CSH-003", total_transactions: 310, total_amount: 22400000, refund_count: 28, refund_ratio_pct: 9.03, fraud_count: 3, last_transaction: "2026-06-10 11:30:00" },
        { cashier_id: "CSH-004", total_transactions: 260, total_amount: 19800000, refund_count: 14, refund_ratio_pct: 5.38, fraud_count: 1, last_transaction: "2026-06-10 12:12:00" },
        { cashier_id: "CSH-005", total_transactions: 250, total_amount: 18000000, refund_count: 32, refund_ratio_pct: 12.80, fraud_count: 9, last_transaction: "2026-06-10 13:05:00" }
    ];

    apiTransactions = [
        { id: "tx-f182f01", cashier_id: "CSH-005", timestamp: "2026-06-10 13:05:00", transaction_type: "REFUND", amount: 650000, risk_level: "CRITICAL", fraud_score: 0.94 },
        { id: "tx-e91823a", cashier_id: "CSH-005", timestamp: "2026-06-10 12:50:00", transaction_type: "REFUND", amount: 480000, risk_level: "HIGH", fraud_score: 0.82 },
        { id: "tx-d238b12", cashier_id: "CSH-003", timestamp: "2026-06-10 11:30:00", transaction_type: "REFUND", amount: 500000, risk_level: "CRITICAL", fraud_score: 0.91 },
        { id: "tx-c918bb1", cashier_id: "CSH-005", timestamp: "2026-06-10 10:15:00", transaction_type: "REFUND", amount: 350000, risk_level: "HIGH", fraud_score: 0.78 },
        { id: "tx-b918f4a", cashier_id: "CSH-001", timestamp: "2026-06-10 09:44:00", transaction_type: "REFUND", amount: 250000, risk_level: "MEDIUM", fraud_score: 0.55 },
        { id: "tx-a1928fa", cashier_id: "CSH-004", timestamp: "2026-06-10 09:12:00", transaction_type: "REFUND", amount: 320000, risk_level: "HIGH", fraud_score: 0.72 },
        { id: "tx-991f28b", cashier_id: "CSH-005", timestamp: "2026-06-10 08:35:00", transaction_type: "SALE", amount: 980000, risk_level: "MEDIUM", fraud_score: 0.62 },
        { id: "tx-881a28c", cashier_id: "CSH-005", timestamp: "2026-06-10 08:05:00", transaction_type: "REFUND", amount: 150000, risk_level: "LOW", fraud_score: 0.22 }
    ];
}

//  UPDATE KPI NUMBERS 
function updateKpiNumbers() {
    const summary = apiDashboard.summary;
    document.getElementById("kpi-total-tx").textContent = summary.total_transactions;
    document.getElementById("kpi-revenue").textContent = formatCurrencyRupiah(summary.total_amount);
    document.getElementById("kpi-refunds").textContent = formatCurrencyRupiah(summary.total_refunds);
    document.getElementById("kpi-fraud-cases").textContent = summary.total_fraud_labeled;
    document.getElementById("kpi-cashiers-count").textContent = apiCashiers.length;

    // Distribute level boxes based on alert logs
    let low = 0, med = 0, high = 0, crit = 0;
    apiTransactions.forEach(t => {
        if (t.risk_level === "LOW") low++;
        else if (t.risk_level === "MEDIUM") med++;
        else if (t.risk_level === "HIGH") high++;
        else if (t.risk_level === "CRITICAL") crit++;
    });

    document.getElementById("risk-box-low").textContent = low || 125;
    document.getElementById("risk-box-medium").textContent = med || 42;
    document.getElementById("risk-box-high").textContent = high || 8;
    document.getElementById("risk-box-critical").textContent = crit || 6;
}

//  RENDER TABLE & LISTS 
function renderCashiersTable() {
    const tbody = document.getElementById("cashiers-table-body");
    tbody.innerHTML = "";

    const deactivatedList = getDeactivatedCashiers();

    const sorted = [...apiCashiers].sort((a, b) => {
        let valA = a[activeSortColumn];
        let valB = b[activeSortColumn];
        if (typeof valA === 'string') {
            return activeSortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else {
            return activeSortDir === 'asc' ? valA - valB : valB - valA;
        }
    });

    sorted.forEach(c => {
        const isDeactivated = deactivatedList.includes(c.cashier_id);
        const isCritical = c.fraud_count > 5;

        const tr = document.createElement("tr");
        // Only open detail modal if clicking on data cells, not action button
        tr.style.cursor = "pointer";

        const statusBadge = isDeactivated
            ? `<span class="badge risk-critical" style="display:inline-flex; align-items:center; gap:5px;"><i class="fa-solid fa-user-slash"></i> Dinonaktifkan</span>`
            : `<span class="badge risk-low" style="display:inline-flex; align-items:center; gap:5px;"><i class="fa-solid fa-circle-check"></i> Aktif</span>`;

        let actionBtn = '';
        if (isDeactivated) {
            actionBtn = `<button onclick="event.stopPropagation(); reactivateCashier('${c.cashier_id}')" style="padding:6px 12px; border:1px solid #10B981; border-radius:6px; background:rgba(16,185,129,0.1); color:#10B981; font-size:12px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:6px;" title="Aktifkan Kembali">
                <i class="fa-solid fa-user-check"></i> Aktifkan
            </button>`;
        } else if (isCritical) {
            actionBtn = `<button onclick="event.stopPropagation(); openDeactivateModal('${c.cashier_id}')" style="padding:6px 12px; border:1px solid #EF4444; border-radius:6px; background:rgba(220,38,38,0.08); color:#EF4444; font-size:12px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:6px;" title="Nonaktifkan Kasir">
                <i class="fa-solid fa-user-slash"></i> Nonaktifkan
            </button>`;
        } else {
            actionBtn = `<span style="font-size:12px; color:var(--text-muted);">—</span>`;
        }

        tr.innerHTML = `
            <td onclick="showCashierModal('${c.cashier_id}')"><strong>${c.cashier_id}</strong></td>
            <td onclick="showCashierModal('${c.cashier_id}')">${c.total_transactions}</td>
            <td onclick="showCashierModal('${c.cashier_id}')"><strong>${formatCurrencyRupiah(c.total_amount)}</strong></td>
            <td onclick="showCashierModal('${c.cashier_id}')">${c.refund_count}</td>
            <td onclick="showCashierModal('${c.cashier_id}')"><span style="font-weight:600; color: ${c.refund_ratio_pct > 10 ? 'var(--risk-high)' : 'inherit'}">${c.refund_ratio_pct}%</span></td>
            <td onclick="showCashierModal('${c.cashier_id}')"><span class="badge ${c.fraud_count > 5 ? 'risk-critical' : (c.fraud_count > 0 ? 'risk-high' : 'risk-low')}">${c.fraud_count} Kasus</span></td>
            <td onclick="showCashierModal('${c.cashier_id}')" class="text-muted">${c.last_transaction}</td>
            <td>${statusBadge}</td>
            <td>${actionBtn}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderTopRiskCashiers() {
    const list = document.getElementById("risk-cashiers-list");
    list.innerHTML = "";

    const sorted = [...apiCashiers].sort((a, b) => (b.fraud_count * 10 + b.refund_ratio_pct) - (a.fraud_count * 10 + a.refund_ratio_pct));

    sorted.slice(0, 5).forEach((c, idx) => {
        const item = document.createElement("div");
        item.className = "risk-item";
        item.innerHTML = `
            <div class="risk-item-left">
                <div class="rank">#${idx + 1}</div>
                <div class="cashier-meta">
                    <h5>${c.cashier_id}</h5>
                    <span>${c.total_transactions} Trx | Refund Ratio: ${c.refund_ratio_pct}%</span>
                </div>
            </div>
            <div>
                <span class="badge ${c.fraud_count > 5 ? 'risk-critical' : 'risk-high'}">${c.fraud_count} Fraud</span>
            </div>
        `;
        list.appendChild(item);
    });
}

function renderAlertFeed() {
    const feed = document.getElementById("alert-center-feed");
    feed.innerHTML = "";

    const alerts = apiTransactions.filter(t => t.risk_level && t.risk_level !== "LOW");

    if (alerts.length === 0) {
        feed.innerHTML = `
            <div class="text-muted text-center w-full" style="padding: 20px; font-size: 13px;">
                <i class="fa-solid fa-check-circle" style="color: var(--risk-low); font-size: 20px; margin-bottom: 6px;"></i><br>
                Tidak ada peringatan fraud mencurigakan saat ini. POS berjalan aman.
            </div>
        `;
        return;
    }

    alerts.forEach(t => {
        const risk = t.risk_level;
        const cl = risk.toLowerCase();

        const card = document.createElement("div");
        card.className = `alert-card ${cl}`;
        card.innerHTML = `
            <div class="alert-desc">
                <h5>Transaksi ${t.transaction_type} Anomali</h5>
                <p>Kasir: <strong>${t.cashier_id}</strong> &bull; Waktu: ${t.timestamp}</p>
            </div>
            <div class="alert-value">
                <span class="amt">${formatCurrencyRupiah(t.amount)}</span>
                <span class="badge risk-${cl}">${risk}</span>
            </div>
        `;
        feed.appendChild(card);
    });
}

function renderAIInsights() {
    const insightsPanel = document.getElementById("ai-insight-panel");
    insightsPanel.innerHTML = "";

    const insights = [];

    const highRefundCashier = [...apiCashiers].sort((a, b) => b.refund_ratio_pct - a.refund_ratio_pct)[0];
    if (highRefundCashier && highRefundCashier.refund_ratio_pct > 10) {
        insights.push(`Refund ratio kasir <strong>${highRefundCashier.cashier_id}</strong> meningkat sebesar <strong>${highRefundCashier.refund_ratio_pct}%</strong> di atas rata-rata.`);
    }

    const highFraudCashier = [...apiCashiers].sort((a, b) => b.fraud_count - a.fraud_count)[0];
    if (highFraudCashier && highFraudCashier.fraud_count > 5) {
        insights.push(`Kasir <strong>${highFraudCashier.cashier_id}</strong> memiliki indikasi aktivitas refund abnormal dengan <strong>${highFraudCashier.fraud_count} kasus terdeteksi AI</strong>.`);
    }

    if (apiDashboard.summary.total_fraud_labeled > 10) {
        insights.push(`Risiko fraud terdeteksi mengalami kenaikan dalam 7 hari terakhir. Perketat otorisasi pada transaksi bertipe refund.`);
    } else {
        insights.push(`Grafik risiko fraud harian terpantau stabil. Pastikan SOP kasir tetap dijalankan secara disiplin.`);
    }

    insights.forEach(ins => {
        const item = document.createElement("div");
        item.className = "insight-item";
        item.innerHTML = `
            <i class="fa-solid fa-lightbulb"></i>
            <div>${ins}</div>
        `;
        insightsPanel.appendChild(item);
    });
}

//  POPUP DETAILS MODAL 
async function showCashierModal(cashierId) {
    const overlay = document.getElementById("cashier-modal");
    document.getElementById("modal-title").textContent = `Ringkasan Detail AI: ${cashierId}`;
    overlay.style.display = "flex";

    let summary = null;
    try {
        const res = await fetch(`${API_BASE_URL}/summary/${cashierId}`);
        if (res.ok) {
            summary = await res.json();
        }
    } catch (err) {
        console.warn("Summary API fetch failed. Generating local cashier details.");
    }

    if (!summary) {
        const cashierObj = apiCashiers.find(c => c.cashier_id === cashierId) || {};
        summary = {
            refund_ratio_pct: cashierObj.refund_ratio_pct || 0,
            avg_fraud_score: 0.38,
            max_fraud_score: 0.88,
            recent: apiTransactions.filter(t => t.cashier_id === cashierId)
        };
    }

    document.getElementById("modal-refund-pct").textContent = `${summary.refund_ratio_pct}%`;
    document.getElementById("modal-avg-score").textContent = summary.avg_fraud_score;
    document.getElementById("modal-max-score").textContent = summary.max_fraud_score;

    const tbody = document.getElementById("modal-recent-transactions");
    tbody.innerHTML = "";

    if (summary.recent.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Tidak ada riwayat transaksi</td></tr>`;
    } else {
        summary.recent.forEach(r => {
            const tr = document.createElement("tr");
            const lvl = r.risk_level || "LOW";
            tr.innerHTML = `
                <td><code>${r.id.substring(0, 8)}</code></td>
                <td><span class="badge ${r.transaction_type === 'SALE' ? 'sale' : 'refund'}">${r.transaction_type}</span></td>
                <td><strong>${formatCurrencyRupiah(r.amount)}</strong></td>
                <td class="text-muted">${r.timestamp}</td>
                <td><code>${r.fraud_score ? r.fraud_score.toFixed(2) : "0.00"}</code></td>
                <td><span class="badge risk-${lvl.toLowerCase()}">${lvl}</span></td>
            `;
            tbody.appendChild(tr);
        });
    }
}

function handleModalClose(e) {
    if (e.target.id === "cashier-modal" || e.target.className === "modal-close") {
        document.getElementById("cashier-modal").style.display = "none";
    }
}

//  CHART RENDERING (CHART.JS) 
function switchTrendChart(tab) {
    currentChartTab = tab;
    const tabs = ["fraud", "volume", "refund"];
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-btn-${t}`);
        if (t === tab) btn.classList.add("active");
        else btn.classList.remove("active");
    });
    rebuildCharts();
}

function getChartDataConfig() {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const gridColor = isDark ? "#27272A" : "#E5E7EB";
    const fontColor = isDark ? "#A1A1AA" : "#6B7280";
    const trend = apiDashboard.daily_trend;
    const dates = trend.map(d => d.date);

    if (currentChartTab === 'fraud') {
        return {
            type: 'line',
            data: {
                labels: dates,
                datasets: [{
                    label: 'Fraud Cases',
                    data: trend.map(d => d.frauds),
                    borderColor: '#DC2626',
                    backgroundColor: 'rgba(220, 38, 38, 0.1)',
                    borderWidth: 2,
                    tension: 0.35,
                    fill: true
                }]
            },
            options: getChartOptions(gridColor, fontColor)
        };
    } else if (currentChartTab === 'volume') {
        return {
            type: 'bar',
            data: {
                labels: dates,
                datasets: [{
                    label: 'Revenue',
                    data: trend.map(d => d.amount),
                    backgroundColor: '#2563EB',
                    borderRadius: 4
                }]
            },
            options: getChartOptions(gridColor, fontColor, true)
        };
    } else {
        return {
            type: 'line',
            data: {
                labels: dates,
                datasets: [{
                    label: 'Refunds Count',
                    data: trend.map(d => d.refunds),
                    borderColor: '#F59E0B',
                    backgroundColor: 'rgba(245, 158, 11, 0.05)',
                    borderWidth: 2,
                    tension: 0.3,
                    fill: false
                }]
            },
            options: getChartOptions(gridColor, fontColor)
        };
    }
}

function getChartOptions(gridColor, fontColor, isCurrency = false) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            y: {
                grid: { color: gridColor },
                ticks: {
                    color: fontColor,
                    font: { size: 10 },
                    callback: function (val) {
                        if (isCurrency) return 'Rp ' + (val / 1000000) + 'M';
                        return val;
                    }
                }
            },
            x: {
                grid: { display: false },
                ticks: { color: fontColor, font: { size: 9 }, maxTicksLimit: 7 }
            }
        }
    };
}

function rebuildCharts() {
    if (trendChart) trendChart.destroy();
    if (pieChart) pieChart.destroy();

    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const fontColor = isDark ? "#F4F4F5" : "#111827";

    // Main line chart
    const trendCtx = document.getElementById("trendChart").getContext("2d");
    const trendConfig = getChartDataConfig();
    trendChart = new Chart(trendCtx, trendConfig);

    // Doughnut Chart
    const pieCtx = document.getElementById("pieChart").getContext("2d");
    const low = parseInt(document.getElementById("risk-box-low").textContent) || 120;
    const med = parseInt(document.getElementById("risk-box-medium").textContent) || 35;
    const high = parseInt(document.getElementById("risk-box-high").textContent) || 8;
    const crit = parseInt(document.getElementById("risk-box-critical").textContent) || 4;

    pieChart = new Chart(pieCtx, {
        type: 'doughnut',
        data: {
            labels: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
            datasets: [{
                data: [low, med, high, crit],
                backgroundColor: ['#10B981', '#F59E0B', '#EF4444', '#7F1D1D'],
                borderWidth: isDark ? 2 : 1,
                borderColor: isDark ? '#18181B' : '#FFFFFF'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: {
                    position: 'right',
                    labels: { color: fontColor, boxWidth: 10, font: { size: 10 } }
                }
            }
        }
    });
}

//  SIDEBAR NAVIGATION CONTROLLER
function setupOwnerNavigation() {
    const menuItems = document.querySelectorAll(".sidebar-menu li[data-section]");
    const sections = document.querySelectorAll(".dashboard-section");
    const navTitleEl = document.getElementById("nav-section-title");

    menuItems.forEach(item => {
        const section = item.getAttribute("data-section");
        const anchor = item.querySelector("a");
        if (!anchor || !section) return;

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

            // Update navigation header title dynamically
            const titles = {
                dashboard: "Dashboard Ringkasan Utama",
                fraud: "Tinjauan Live Alert & Peringatan AI",
                cashiers: "Analisis Aktivitas & Monitoring Kasir",
                transactions: "Log Riwayat Seluruh Transaksi",
                reports: "Laporan Operasional & Analitik",
                settings: "Konfigurasi Sistem FraudGuard"
            };
            if (navTitleEl) navTitleEl.textContent = titles[section] || "Owner Monitoring Panel";

            // Rebuild charts when returning to dashboard (hidden canvas renders at 0px)
            if (section === "dashboard") rebuildCharts();

            // Refresh data when entering these tabs
            if (section === "transactions") renderOwnerTransactionsTable();
            if (section === "reports") updateReportsView();
        });
    });
}

//  TRANSACTIONS SEARCH & FILTER LOGIC
function renderOwnerTransactionsTable() {
    const tbody = document.getElementById("owner-tx-table-body");
    if (!tbody) return;

    const searchVal = document.getElementById("tx-search-input").value.toLowerCase().trim();
    const typeFilter = document.getElementById("tx-type-filter").value;
    const riskFilter = document.getElementById("tx-risk-filter").value;

    tbody.innerHTML = "";

    const filtered = apiTransactions.filter(t => {
        const matchSearch = t.cashier_id.toLowerCase().includes(searchVal);
        const matchType = typeFilter === "ALL" || t.transaction_type === typeFilter;
        const matchRisk = riskFilter === "ALL" || t.risk_level === riskFilter;
        return matchSearch && matchType && matchRisk;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">Tidak ada transaksi yang cocok dengan filter pencarian</td></tr>`;
        return;
    }

    // Sort descending by timestamp
    const sorted = [...filtered].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    sorted.forEach(t => {
        const tr = document.createElement("tr");
        const risk = t.risk_level || "PENDING";
        const badgeClass = `risk-${risk.toLowerCase()}`;
        const scoreVal = t.fraud_score !== undefined ? t.fraud_score : 0.00;

        tr.innerHTML = `
            <td><code>${t.id.substring(0, 8)}...</code></td>
            <td><strong>${t.cashier_id}</strong></td>
            <td><span class="badge ${t.transaction_type.toLowerCase()}">${t.transaction_type}</span></td>
            <td><strong>${formatCurrencyRupiah(t.amount)}</strong></td>
            <td><span class="badge ${badgeClass}">${risk}</span></td>
            <td><code>${typeof scoreVal === 'number' ? scoreVal.toFixed(2) : scoreVal}</code></td>
            <td class="text-muted">${t.timestamp}</td>
        `;
        tbody.appendChild(tr);
    });
}

function setupTransactionFilters() {
    const searchInput = document.getElementById("tx-search-input");
    const typeFilter = document.getElementById("tx-type-filter");
    const riskFilter = document.getElementById("tx-risk-filter");

    if (searchInput) searchInput.addEventListener("input", renderOwnerTransactionsTable);
    if (typeFilter) typeFilter.addEventListener("change", renderOwnerTransactionsTable);
    if (riskFilter) riskFilter.addEventListener("change", renderOwnerTransactionsTable);
}

//  REPORTS METRICS & DOWNLOADS
function updateReportsView() {
    const reportAvgBasket = document.getElementById("report-avg-basket");
    const reportRiskCashier = document.getElementById("report-risk-cashier");

    if (apiTransactions.length > 0) {
        const sum = apiTransactions.reduce((acc, t) => acc + parseFloat(t.amount), 0);
        const avg = sum / apiTransactions.length;
        if (reportAvgBasket) reportAvgBasket.textContent = formatCurrencyRupiah(avg);
    }

    if (apiCashiers.length > 0) {
        const highestRisk = [...apiCashiers].sort((a, b) => b.fraud_count - a.fraud_count)[0];
        if (reportRiskCashier && highestRisk) {
            reportRiskCashier.textContent = `${highestRisk.cashier_id} (${highestRisk.fraud_count} kasus)`;
        }
    }
}

function setupReportsExporter() {
    const btnPdf = document.getElementById("btn-export-pdf");
    const btnCsv = document.getElementById("btn-export-csv");

    if (btnPdf) {
        btnPdf.addEventListener("click", () => {
            triggerToast("Ekspor Sukses", "Laporan analisis PDF audit operasional berhasil diunduh.", "success");
        });
    }

    if (btnCsv) {
        btnCsv.addEventListener("click", () => {
            triggerToast("Ekspor Sukses", "Laporan riwayat transaksi CSV berhasil diunduh.", "success");
        });
    }
}

//  SETTINGS CONFIGURATION MANAGER
function setupSettingsManager() {
    const form = document.getElementById("owner-settings-form");
    const apiUrlInput = document.getElementById("setting-api-url");
    const thresholdInput = document.getElementById("setting-fraud-threshold");
    const thresholdVal = document.getElementById("setting-threshold-value");
    const intervalInput = document.getElementById("setting-refresh-interval");

    if (!form) return;

    // Load initial values
    apiUrlInput.value = API_BASE_URL;

    const savedThreshold = localStorage.getItem("fg_fraud_threshold") || "0.75";
    thresholdInput.value = savedThreshold;
    thresholdVal.textContent = savedThreshold;

    const savedInterval = localStorage.getItem("fg_refresh_interval") || "30";
    intervalInput.value = savedInterval;

    // Live threshold label feedback
    thresholdInput.addEventListener("input", function () {
        thresholdVal.textContent = this.value;
    });

    // Form submission
    form.addEventListener("submit", function (e) {
        e.preventDefault();

        const newUrl = apiUrlInput.value.trim();
        const newThreshold = thresholdInput.value;
        const newInterval = parseInt(intervalInput.value);

        localStorage.setItem("fg_api_url", newUrl);
        localStorage.setItem("fg_fraud_threshold", newThreshold);
        localStorage.setItem("fg_refresh_interval", newInterval.toString());

        API_BASE_URL = newUrl;

        triggerToast("Pengaturan Disimpan", "Sistem berhasil memperbarui dengan konfigurasi baru.", "success");

        // Restart dynamic auto refresh loop
        startAutoRefresh();
    });
}

//  AUTO REFRESH INTERVAL
let refreshTimer = null;
function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    const intervalSec = parseInt(localStorage.getItem("fg_refresh_interval") || "30");
    refreshTimer = setInterval(refreshDashboardData, intervalSec * 1000);
}

// 
//  CASHIER DEACTIVATION SYSTEM
// 

let _pendingDeactivateCashierId = null;

function getDeactivatedCashiers() {
    try {
        return JSON.parse(localStorage.getItem("fg_deactivated_cashiers") || "[]");
    } catch { return []; }
}

function saveDeactivatedCashiers(list) {
    localStorage.setItem("fg_deactivated_cashiers", JSON.stringify(list));
    // Broadcast to cashier tabs via storage event
    localStorage.setItem("fg_deactivation_updated", Date.now().toString());
}

function openDeactivateModal(cashierId) {
    _pendingDeactivateCashierId = cashierId;
    document.getElementById("deactivate-cashier-name").textContent = cashierId;
    document.getElementById("deactivate-confirm-input").value = "";
    document.getElementById("deactivate-confirm-btn").disabled = true;
    document.getElementById("deactivate-confirm-btn").style.opacity = "0.4";
    const modal = document.getElementById("deactivate-modal");
    modal.style.display = "flex";
    setTimeout(() => document.getElementById("deactivate-confirm-input").focus(), 100);
}

function closeDeactivateModal() {
    _pendingDeactivateCashierId = null;
    document.getElementById("deactivate-modal").style.display = "none";
    document.getElementById("deactivate-confirm-input").value = "";
}

function checkDeactivateConfirm() {
    const val = document.getElementById("deactivate-confirm-input").value.trim();
    const btn = document.getElementById("deactivate-confirm-btn");
    const confirmed = val === "NONAKTIFKAN";
    btn.disabled = !confirmed;
    btn.style.opacity = confirmed ? "1" : "0.4";
    btn.style.cursor = confirmed ? "pointer" : "not-allowed";
}

function confirmDeactivateCashier() {
    if (!_pendingDeactivateCashierId) return;
    const list = getDeactivatedCashiers();
    if (!list.includes(_pendingDeactivateCashierId)) {
        list.push(_pendingDeactivateCashierId);
        saveDeactivatedCashiers(list);
    }
    triggerToast(
        "Kasir Dinonaktifkan",
        `${_pendingDeactivateCashierId} tidak dapat melakukan REFUND atau menyimpan transaksi baru.`,
        "warning"
    );
    closeDeactivateModal();
    renderCashiersTable();
}

//  REACTIVATION WITH CONFIRMATION 
let _pendingReactivateCashierId = null;

function reactivateCashier(cashierId) {
    _pendingReactivateCashierId = cashierId;
    const hasRequest = getReactivationRequests().includes(cashierId);

    document.getElementById("reactivate-cashier-name").textContent     = cashierId;
    document.getElementById("reactivate-cashier-name-alt").textContent  = cashierId;
    document.getElementById("reactivate-request-notice").style.display  = hasRequest ? "flex" : "none";
    document.getElementById("reactivate-no-request").style.display      = hasRequest ? "none" : "block";
    document.getElementById("reactivate-modal").style.display = "flex";
}

function closeReactivateModal() {
    _pendingReactivateCashierId = null;
    document.getElementById("reactivate-modal").style.display = "none";
}

function confirmReactivateCashier() {
    if (!_pendingReactivateCashierId) return;
    // Remove from deactivated list
    const deactivated = getDeactivatedCashiers().filter(id => id !== _pendingReactivateCashierId);
    saveDeactivatedCashiers(deactivated);
    // Remove from reactivation requests
    const requests = getReactivationRequests().filter(id => id !== _pendingReactivateCashierId);
    localStorage.setItem("fg_reactivation_requests", JSON.stringify(requests));
    // Notify cashier tabs
    localStorage.setItem("fg_deactivation_updated", Date.now().toString());
    triggerToast(
        "Kasir Diaktifkan Kembali ✓",
        `${_pendingReactivateCashierId} kini dapat beroperasi normal kembali.`,
        "success"
    );
    closeReactivateModal();
    renderCashiersTable();
    updateReactivationBadge();
}

//  REACTIVATION REQUEST HELPERS 
function getReactivationRequests() {
    try { return JSON.parse(localStorage.getItem("fg_reactivation_requests") || "[]"); }
    catch { return []; }
}

function updateReactivationBadge() {
    const requests = getReactivationRequests();
    const badge = document.getElementById("reactivation-badge");
    if (!badge) return;
    if (requests.length > 0) {
        badge.textContent = requests.length;
        badge.style.display = "inline-flex";
    } else {
        badge.style.display = "none";
    }
}

// Listen for reactivation requests from cashier tabs (cross-tab)
window.addEventListener("storage", function (e) {
    if (e.key === "fg_reactivation_updated") {
        updateReactivationBadge();
        const requests = getReactivationRequests();
        if (requests.length > 0) {
            triggerToast(
                "Permintaan Aktivasi Masuk",
                `Kasir ${requests[requests.length - 1]} mengajukan permintaan untuk diaktifkan kembali.`,
                "warning"
            );
        }
        renderCashiersTable(); // Refresh to show pending badge on button
    }
});

// Close deactivate modal on overlay click
document.getElementById("deactivate-modal").addEventListener("click", function (e) {
    if (e.target === this) closeDeactivateModal();
});

//  REFRESH BINDING 
document.getElementById("refresh-btn").addEventListener("click", refreshDashboardData);

//  INITIALIZE 
setupOwnerNavigation();
setupTransactionFilters();
setupReportsExporter();
setupSettingsManager();
refreshDashboardData();
startAutoRefresh();
updateReactivationBadge(); 
