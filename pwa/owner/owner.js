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

let isRefreshing = false;
let refreshAbortController = null;

function showOfflineBanner() {
    let banner = document.getElementById("offline-banner");
    if (!banner) {
        banner = document.createElement("div");
        banner.id = "offline-banner";
        banner.style.cssText = "background: #f59e0b; color: white; text-align: center; padding: 10px; font-weight: bold; position: fixed; top: 0; left: 0; width: 100%; z-index: 1000;";
        banner.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Menampilkan Data Simulasi (Offline Mode)`;
        document.body.prepend(banner);
        document.querySelector("main") && (document.querySelector("main").style.marginTop = "40px");
    }
}

function hideOfflineBanner() {
    const banner = document.getElementById("offline-banner");
    if (banner) {
        banner.remove();
        document.querySelector("main") && (document.querySelector("main").style.marginTop = "");
    }
}

//  FETCH & LOAD DATA 
async function refreshDashboardData() {
    if (isRefreshing) {
        if (refreshAbortController) refreshAbortController.abort();
    }
    isRefreshing = true;
    refreshAbortController = new AbortController();
    const signal = refreshAbortController.signal;

    const refreshBtn = document.getElementById("refresh-btn");
    if (refreshBtn) {
        const icon = refreshBtn.querySelector("i");
        if (icon) icon.classList.add("fa-spin");
    }

    try {
        // Auto-run batch score to evaluate any unscored/pending transactions first
        try {
            await fetch(`${API_BASE_URL}/batch-score`, {
                method: "POST",
                signal,
                headers: {
                    "Content-Type": "application/json",
                    "X-API-Key": "fraudguard-capstone-2026"
                },
                body: JSON.stringify({})
            });
        } catch (scoreErr) {
            console.warn("Auto batch score warning:", scoreErr);
        }

        // Fetch stats from common.js base API URL
        const dashRes = await fetch(`${API_BASE_URL}/dashboard`, {
            signal,
            headers: { "X-API-Key": "fraudguard-capstone-2026" }
        });
        if (dashRes.ok) {
            apiDashboard = await dashRes.json();
        } else throw new Error(`Dashboard API Error: ${dashRes.status}`);

        const cashiersRes = await fetch(`${API_BASE_URL}/cashiers`, {
            signal,
            headers: { "X-API-Key": "fraudguard-capstone-2026" }
        });
        if (cashiersRes.ok) {
            const data = await cashiersRes.json();
            apiCashiers = data.cashiers;
        } else throw new Error(`Cashiers API Error: ${cashiersRes.status}`);

        const txsRes = await fetch(`${API_BASE_URL}/transactions?per_page=500`, {
            signal,
            headers: { "X-API-Key": "fraudguard-capstone-2026" }
        });
        if (txsRes.ok) {
            const data = await txsRes.json();
            apiTransactions = data.transactions;
        } else throw new Error(`Transactions API Error: ${txsRes.status}`);
        hideOfflineBanner();
    } catch (err) {
        if (err.name === 'AbortError') {
            console.log("Fetch aborted for newer refresh.");
            return;
        }
        console.error("Backend API error:", err);
        triggerToast("Offline Mode", `Fetch Error: ${err.message}`, "critical");
        showOfflineBanner();
        return;
    } finally {
        isRefreshing = false;
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

    if (refreshBtn) {
        setTimeout(() => {
            const icon = refreshBtn.querySelector("i");
            if (icon) icon.classList.remove("fa-spin");
        }, 600);
    }
}


//  CURRENCY SHORT FORMAT 
function formatCurrencyShort(amount) {
    const num = Number(amount) || 0;
    function compact(val, suffix) {
        const r = Math.round(val * 10) / 10;
        const str = Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1);
        return `Rp ${str.replace('.', ',')} ${suffix}`;
    }
    if (num >= 1_000_000_000) return compact(num / 1_000_000_000, 'M');
    if (num >= 1_000_000) return compact(num / 1_000_000, 'Jt');
    if (num >= 1_000) return compact(num / 1_000, 'Rb');
    return `Rp ${num.toLocaleString('id-ID')}`;
}

//  UPDATE KPI NUMBERS 
function updateKpiNumbers() {
    const summary = apiDashboard.summary;
    document.getElementById("kpi-total-tx").textContent = summary.total_transactions;
    document.getElementById("kpi-revenue").textContent = formatCurrencyShort(summary.total_amount);
    document.getElementById("kpi-refunds").textContent = formatCurrencyShort(summary.total_refund_amount || 0);
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

    document.getElementById("risk-box-low").textContent = low;
    document.getElementById("risk-box-medium").textContent = med;
    document.getElementById("risk-box-high").textContent = high;
    document.getElementById("risk-box-critical").textContent = crit;
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

    // Urutkan dengan bobot: CRITICAL sangat berisiko (*10), HIGH berisiko sedang (*3), ditambah rasio refund
    const sorted = [...apiCashiers].sort((a, b) => {
        const riskA = (a.critical_count || 0) * 10 + (a.high_count || 0) * 3 + (a.refund_ratio_pct || 0);
        const riskB = (b.critical_count || 0) * 10 + (b.high_count || 0) * 3 + (b.refund_ratio_pct || 0);
        return riskB - riskA;
    });

    sorted.slice(0, 5).forEach((c, idx) => {
        const aiRisk = c.ai_risk_count || c.fraud_count || 0;
        const item = document.createElement("div");
        item.className = "risk-item";
        item.innerHTML = `
            <div class="risk-item-left">
                <div class="rank">#${idx + 1}</div>
                <div class="cashier-meta">
                    <h5>${c.cashier_id}</h5>
                    <span>${c.total_transactions} Trx | Refund Ratio: ${c.refund_ratio_pct}% | Avg Fraud Score: ${(c.avg_fraud_score || 0).toFixed(1)}</span>
                </div>
            </div>
            <div>
                <span class="badge ${aiRisk > 5 ? 'risk-critical' : 'risk-high'}">${aiRisk} Fraud</span>
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
        insights.push(`Kasir <strong>${highFraudCashier.cashier_id}</strong> memiliki indikasi aktivitas transaksi anomali dengan <strong>${highFraudCashier.fraud_count} kasus terdeteksi AI</strong>.`);
    }

    if (apiDashboard.summary.total_fraud_labeled > 10) {
        insights.push(`Risiko fraud terdeteksi mengalami kenaikan dalam 7 hari terakhir. Perketat otorisasi pada transaksi berisiko tinggi (termasuk SALE larut malam).`);
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

    // FIX BUG 4 (owner.js): Load summary stats + ALL cashier transactions in parallel
    // /api/summary hanya mengembalikan 10 transaksi terbaru di field 'recent',
    // sementara /api/transactions?cashier_id=... mendukung pagination penuh.
    let summary = null;
    let cashierTxns = [];

    try {
        const [summaryRes, txnsRes] = await Promise.all([
            fetch(`${API_BASE_URL}/summary/${cashierId}`, {
                headers: { "X-API-Key": "fraudguard-capstone-2026" }
            }),
            fetch(`${API_BASE_URL}/transactions?cashier_id=${encodeURIComponent(cashierId)}&per_page=500&sort=desc`, {
                headers: { "X-API-Key": "fraudguard-capstone-2026" }
            }),
        ]);

        if (summaryRes.ok) {
            summary = await summaryRes.json();
        }
        if (txnsRes.ok) {
            const txnsData = await txnsRes.json();
            cashierTxns = txnsData.transactions || [];
        }
    } catch (err) {
        console.warn("Modal API fetch failed. Falling back to local data.", err);
    }

    // Override atau fallback menggunakan data agregat penuh dari apiCashiers
    const cashierObj = apiCashiers.find(c => c.cashier_id === cashierId) || {};
    if (!summary) {
        summary = {
            refund_ratio_pct: cashierObj.refund_ratio_pct || 0,
            avg_fraud_score: cashierObj.avg_fraud_score || 0,
            max_fraud_score: 0,
        };
    } else {
        // Timpa metrik dengan agregat dari apiCashiers agar 100% konsisten
        if (cashierObj.refund_ratio_pct !== undefined) summary.refund_ratio_pct = cashierObj.refund_ratio_pct;
        if (cashierObj.avg_fraud_score !== undefined) summary.avg_fraud_score = cashierObj.avg_fraud_score;
    }
    if (cashierTxns.length === 0) {
        cashierTxns = apiTransactions.filter(t => t.cashier_id === cashierId);
    }

    document.getElementById("modal-refund-pct").textContent = `${summary.refund_ratio_pct}%`;
    document.getElementById("modal-avg-score").textContent = summary.avg_fraud_score;
    document.getElementById("modal-max-score").textContent = summary.max_fraud_score;

    const tbody = document.getElementById("modal-recent-transactions");
    tbody.innerHTML = "";

    if (cashierTxns.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Tidak ada riwayat transaksi</td></tr>`;
    } else {
        cashierTxns.forEach(r => {
            const tr = document.createElement("tr");
            const lvl = r.risk_level || "LOW";
            tr.innerHTML = `
                <td><code>${r.id.substring(0, 8)}</code></td>
                <td><span class="badge ${r.transaction_type === 'SALE' ? 'sale' : 'refund'}">${r.transaction_type}</span></td>
                <td><strong>${formatCurrencyRupiah(r.amount)}</strong></td>
                <td class="text-muted">${r.timestamp}</td>
                <td><code>${r.fraud_score != null ? Number(r.fraud_score).toFixed(2) : "0.00"}</code></td>
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
    
    const getVal = (id) => {
        const val = parseInt(document.getElementById(id).textContent, 10);
        return isNaN(val) ? 0 : val;
    };
    
    const low = getVal("risk-box-low");
    const med = getVal("risk-box-medium");
    const high = getVal("risk-box-high");
    const crit = getVal("risk-box-critical");

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

    // Sort descending by timestamp (Safari compatible)
    const sorted = [...filtered].sort((a, b) => new Date(b.timestamp.replace(' ', 'T')) - new Date(a.timestamp.replace(' ', 'T')));

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
        const highestRisk = [...apiCashiers].sort((a, b) => {
            const riskA = (a.critical_count || 0) * 10 + (a.high_count || 0) * 3 + (a.refund_ratio_pct || 0);
            const riskB = (b.critical_count || 0) * 10 + (b.high_count || 0) * 3 + (b.refund_ratio_pct || 0);
            return riskB - riskA;
        })[0];

        if (reportRiskCashier && highestRisk) {
            const riskCount = highestRisk.ai_risk_count || highestRisk.fraud_count || 0;
            reportRiskCashier.textContent = `${highestRisk.cashier_id} (${riskCount} peringatan)`;
        }
    }
}

function setupReportsExporter() {
    const btnPdf = document.getElementById("btn-export-pdf");
    const btnCsv = document.getElementById("btn-export-csv");

    if (btnPdf) {
        btnPdf.addEventListener("click", () => {
            if (typeof window.jspdf === "undefined") {
                triggerToast("Memuat Modul", "Mohon tunggu, memuat modul PDF...", "info");
                const script = document.createElement("script");
                script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
                script.onload = () => generatePDFReport();
                document.body.appendChild(script);
            } else {
                generatePDFReport();
            }
        });
    }

    if (btnCsv) {
        btnCsv.addEventListener("click", () => {
            if (apiTransactions.length === 0) {
                triggerToast("Ekspor Gagal", "Tidak ada data untuk diekspor.", "warning");
                return;
            }

            const headers = ["ID", "Cashier ID", "Timestamp", "Type", "Amount", "Risk Level", "Fraud Score"];
            const csvRows = [headers.join(",")];

            apiTransactions.forEach(t => {
                const row = [
                    t.id,
                    t.cashier_id,
                    t.timestamp,
                    t.transaction_type,
                    t.amount,
                    t.risk_level || "LOW",
                    t.fraud_score || 0
                ];
                csvRows.push(row.join(","));
            });

            const blob = new Blob([csvRows.join("\n")], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `FraudGuard_Transactions_${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            URL.revokeObjectURL(url);

            triggerToast("Ekspor Sukses", "Laporan riwayat transaksi CSV berhasil diunduh.", "success");
        });
    }
}


function generatePDFReport() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("FraudGuard AI Monitoring Report", 20, 20);

    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text(`Generated: ${new Date().toLocaleString('id-ID')}`, 20, 30);

    doc.text(`Total Transactions: ${apiDashboard?.summary?.total_transactions || 0}`, 20, 45);
    doc.text(`Total Fraud Cases: ${apiDashboard?.summary?.total_fraud_labeled || 0}`, 20, 52);
    doc.text(`Total Refunds: ${apiDashboard?.summary?.total_refunds || 0}`, 20, 59);

    doc.setFont("helvetica", "bold");
    doc.text("Top Risk Cashiers", 20, 75);
    doc.setFont("helvetica", "normal");

    let yPos = 85;
    const sortedCashiers = [...apiCashiers].sort((a, b) => {
        const riskA = (a.critical_count || 0) * 10 + (a.high_count || 0) * 3 + (a.refund_ratio_pct || 0);
        const riskB = (b.critical_count || 0) * 10 + (b.high_count || 0) * 3 + (b.refund_ratio_pct || 0);
        return riskB - riskA;
    }).slice(0, 5);

    sortedCashiers.forEach((c, idx) => {
        const riskCount = c.ai_risk_count || c.fraud_count || 0;
        doc.text(`${idx + 1}. ${c.cashier_id} - ${riskCount} peringatan AI (Refund Ratio: ${c.refund_ratio_pct}%)`, 20, yPos);
        yPos += 7;
    });

    doc.save(`FraudGuard_Report_${new Date().toISOString().split('T')[0]}.pdf`);
    triggerToast("Ekspor Sukses", "Laporan analisis PDF audit operasional berhasil diunduh.", "success");
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

    document.getElementById("reactivate-cashier-name").textContent = cashierId;
    document.getElementById("reactivate-cashier-name-alt").textContent = cashierId;
    document.getElementById("reactivate-request-notice").style.display = hasRequest ? "flex" : "none";
    document.getElementById("reactivate-no-request").style.display = hasRequest ? "none" : "block";
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

refreshDashboardData();
startAutoRefresh();
updateReactivationBadge();