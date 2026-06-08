// Mengatur interaksi UI, mengambil data API, dan menangani form kasir

// Fungsi untuk mengambil data statistik dari API dan menampilkannya
async function muatDashboard() {
    let urlAPI;
    let respons;
    let data;
    let elemenDashboard;

    urlAPI = 'http://127.0.0.1:5000/api/dashboard';

    try {
        respons = await fetch(urlAPI);
        if (respons.ok) {
            data = await respons.json();
            elemenDashboard = document.getElementById('data-dashboard');

            if (elemenDashboard) {
                // Menampilkan total transaksi sementara sebagai contoh
                elemenDashboard.innerHTML = `
                    <p>Total Transaksi: <strong>${data.summary.total_transactions}</strong></p>
                    <p>Total Fraud Dilabeli: <strong>${data.summary.total_fraud_labeled}</strong></p>
                `;
            }
        }
    } catch (error) {
        console.error('Gagal memuat dashboard (mungkin sedang offline):', error);
    }
}

// Fungsi untuk menangani submit form dari kasir
async function prosesTransaksiBaru(event) {
    let idKasir;
    let tipeTransaksi;
    let jumlahAmount;
    let dataTransaksi;

    // Mencegah halaman reload saat form dikirim
    event.preventDefault();

    // Mengambil nilai dari input HTML (id ini akan kita buat di index.html nanti)
    idKasir = document.getElementById('input-cashier').value;
    tipeTransaksi = document.getElementById('input-type').value;
    jumlahAmount = document.getElementById('input-amount').value;

    // Menyusun objek data
    dataTransaksi = {
        cashier_id: idKasir,
        timestamp: new Date().toISOString(),
        transaction_type: tipeTransaksi,
        amount: parseFloat(jumlahAmount)
    };

    // 1. Simpan ke database lokal terlebih dahulu (memanggil fungsi dari db.js)
    await saveTransaction(dataTransaksi);

    // 2. Coba sinkronisasi langsung ke backend jika sedang online
    syncAndScore();

    // 3. Kosongkan form setelah input berhasil
    document.getElementById('form-transaksi').reset();

    // Opsional: Beri tahu kasir bahwa input berhasil masuk antrean
    showAlert("Transaksi berhasil dicatat", "success");
}

// Fungsi helper untuk menampilkan notifikasi UI (dipanggil juga oleh db.js)
function showAlert(pesan, level) {
    let kotakAlert;

    kotakAlert = document.createElement('div');
    kotakAlert.className = 'alert ' + level;
    kotakAlert.innerText = pesan;

    document.body.prepend(kotakAlert);

    // Hilangkan notifikasi setelah 4 detik
    setTimeout(function () {
        kotakAlert.remove();
    }, 4000);
}

// Fungsi helper untuk memperbarui dashboard setelah sinkronisasi berhasil (dipanggil oleh db.js)
function updateDashboard(scoredData) {
    console.log('Memperbarui UI dengan data yang sudah di-score:', scoredData);
    muatDashboard(); // Panggil ulang API dashboard untuk mendapatkan angka terbaru
    muatRiwayatTransaksi();
}
// Fungsi untuk mengambil dan menampilkan tabel riwayat transaksi
async function muatRiwayatTransaksi() {

    // Deklarasi semua variabel di awal fungsi
    let urlAPI;
    let respons;
    let data;
    let elemenTabelBody;
    let htmlTabel;
    let i;
    let barisData;
    let tingkatRisiko;

    urlAPI = 'http://127.0.0.1:5000/api/transactions?per_page=5'; // Ambil 5 transaksi terakhir
    htmlTabel = '';

    try {
        respons = await fetch(urlAPI);
        if (respons.ok) {
            data = await respons.json();
            elemenTabelBody = document.getElementById('body-riwayat-transaksi');

            if (elemenTabelBody) {
                // Gunakan perulangan untuk menyusun baris tabel
                for (i = 0; i < data.transactions.length; i++) {
                    barisData = data.transactions[i];
                    tingkatRisiko = barisData.risk_level;

                    // Beri nilai default jika belum ada skor
                    if (!tingkatRisiko) {
                        tingkatRisiko = 'Menunggu Skor...';
                    }

                    // Tambahkan data ke dalam variabel htmlTabel
                    htmlTabel += `
                        <tr>
                            <td>${barisData.cashier_id}</td>
                            <td>${barisData.transaction_type}</td>
                            <td>Rp ${barisData.amount}</td>
                            <td><strong>${tingkatRisiko}</strong></td>
                        </tr>
                    `;
                }

                // Tampilkan ke layar
                elemenTabelBody.innerHTML = htmlTabel;
            }
        }
    } catch (error) {
        console.error('Gagal memuat riwayat:', error);
    }
}
// Menjalankan fungsi saat halaman web pertama kali dimuat
window.onload = function () {
    let formTransaksi;

    // Muat data dashboard
    muatDashboard();
    muatRiwayatTransaksi();

    formTransaksi = document.getElementById('form-transaksi');
    if (formTransaksi) {
        formTransaksi.addEventListener('submit', prosesTransaksiBaru);
    }
};