import React, { useState, useEffect, useMemo, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Plus, TrendingUp, TrendingDown, Package, Sparkles, Send, Loader2, Trash2, Wifi } from "lucide-react";
import { supabase } from "./supabaseClient";

const fmtRupiah = (n) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

async function tanyaClaude(prompt, maxTokens = 1000) {
  const response = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, maxTokens }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "Gagal menghubungi AI");
  return result.text;
}

export default function App() {
  const [data, setData] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [form, setForm] = useState({ tanggal: "", produk: "", qty: "", harga: "" });
  const [narasi, setNarasi] = useState("");
  const [loadingNarasi, setLoadingNarasi] = useState(false);
  const [pertanyaan, setPertanyaan] = useState("");
  const [jawaban, setJawaban] = useState("");
  const [loadingJawaban, setLoadingJawaban] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const muatData = useCallback(async () => {
    setLoadingData(true);
    const { data: rows, error } = await supabase
      .from("penjualan")
      .select("*")
      .order("tanggal", { ascending: true });
    if (error) {
      setErrorMsg("Gagal memuat data: " + error.message);
    } else {
      setData(rows || []);
      setErrorMsg("");
    }
    setLoadingData(false);
  }, []);

  useEffect(() => {
    muatData();

    // Realtime subscription: dashboard update otomatis kalau ada perubahan data
    const channel = supabase
      .channel("penjualan-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "penjualan" }, () => {
        muatData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [muatData]);

  const tambahData = async () => {
    if (!form.tanggal || !form.produk || !form.qty || !form.harga) return;
    const { error } = await supabase.from("penjualan").insert({
      tanggal: form.tanggal,
      produk: form.produk,
      qty: Number(form.qty),
      harga: Number(form.harga),
    });
    if (error) {
      setErrorMsg("Gagal menyimpan data: " + error.message);
      return;
    }
    setForm({ tanggal: "", produk: "", qty: "", harga: "" });
  };

  const hapusData = async (id) => {
    const { error } = await supabase.from("penjualan").delete().eq("id", id);
    if (error) setErrorMsg("Gagal menghapus data: " + error.message);
  };

  const ringkasan = useMemo(() => {
    if (data.length === 0) return null;
    const totalOmzet = data.reduce((sum, d) => sum + d.qty * d.harga, 0);

    const perProduk = {};
    data.forEach((d) => {
      if (!perProduk[d.produk]) perProduk[d.produk] = { qty: 0, omzet: 0 };
      perProduk[d.produk].qty += d.qty;
      perProduk[d.produk].omzet += d.qty * d.harga;
    });
    const produkTerlaris = Object.entries(perProduk).sort((a, b) => b[1].qty - a[1].qty)[0];

    const perTanggal = {};
    data.forEach((d) => {
      if (!perTanggal[d.tanggal]) perTanggal[d.tanggal] = 0;
      perTanggal[d.tanggal] += d.qty * d.harga;
    });
    const tanggalUrut = Object.keys(perTanggal).sort();
    const grafikHarian = tanggalUrut.map((t) => ({
      tanggal: t.slice(5),
      omzet: perTanggal[t],
    }));

    let tren = null;
    if (tanggalUrut.length >= 2) {
      const awal = perTanggal[tanggalUrut[0]];
      const akhir = perTanggal[tanggalUrut[tanggalUrut.length - 1]];
      tren = awal === 0 ? null : ((akhir - awal) / awal) * 100;
    }

    const produkMenurun = Object.entries(perProduk).find(([nama]) => {
      const entriesProduk = data.filter((d) => d.produk === nama).sort((a, b) => a.tanggal.localeCompare(b.tanggal));
      if (entriesProduk.length < 2) return false;
      const terakhir = entriesProduk[entriesProduk.length - 1].qty;
      const sebelumnya = entriesProduk[entriesProduk.length - 2].qty;
      return terakhir < sebelumnya * 0.5;
    });

    return { totalOmzet, produkTerlaris, grafikHarian, tren, produkMenurun, perProduk };
  }, [data]);

  const buatRingkasanTeks = () => {
    if (!ringkasan) return "";
    const produkList = Object.entries(ringkasan.perProduk)
      .map(([nama, v]) => `${nama}: terjual ${v.qty} unit, omzet ${fmtRupiah(v.omzet)}`)
      .join("; ");
    return `Data penjualan UMKM. Total omzet: ${fmtRupiah(ringkasan.totalOmzet)}. Rincian per produk: ${produkList}. Data harian (tanggal: omzet): ${ringkasan.grafikHarian
      .map((g) => `${g.tanggal}: ${fmtRupiah(g.omzet)}`)
      .join(", ")}.`;
  };

  const generateNarasi = async () => {
    if (!ringkasan) return;
    setLoadingNarasi(true);
    setNarasi("");
    try {
      const teks = await tanyaClaude(
        `Kamu adalah asisten bisnis untuk pemilik UMKM di Indonesia (warung, kedai kecil). Berdasarkan data berikut, tulis narasi insight singkat (3-5 kalimat) dalam Bahasa Indonesia yang santai, mudah dipahami orang awam, TANPA jargon bisnis atau istilah teknis. Sebutkan produk terlaris, tren omzet, dan kalau ada produk yang penjualannya turun tajam beri peringatan ramah untuk cek stok atau strategi. Data: ${buatRingkasanTeks()}`
      );
      setNarasi(teks);
    } catch (err) {
      setNarasi("Gagal membuat narasi. Coba lagi ya.");
    } finally {
      setLoadingNarasi(false);
    }
  };

  const tanyaAI = async () => {
    if (!pertanyaan.trim() || !ringkasan) return;
    setLoadingJawaban(true);
    setJawaban("");
    try {
      const teks = await tanyaClaude(
        `Kamu asisten bisnis UMKM Indonesia. Data penjualan: ${buatRingkasanTeks()}. Jawab pertanyaan pemilik toko ini dengan bahasa santai dan singkat: "${pertanyaan}"`,
        800
      );
      setJawaban(teks);
    } catch (err) {
      setJawaban("Gagal memproses pertanyaan. Coba lagi ya.");
    } finally {
      setLoadingJawaban(false);
      setPertanyaan("");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#FDF8F0", fontFamily: "'Inter', sans-serif", color: "#1A2E1A" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');
        .display { font-family: 'Sora', sans-serif; }
        input:focus, textarea:focus { outline: 2px solid #E8935C; outline-offset: 1px; }
        button:focus-visible { outline: 2px solid #E8935C; outline-offset: 2px; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      <header style={{ padding: "28px 20px 20px", borderBottom: "3px solid #1A2E1A" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <div className="display" style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", color: "#E8935C", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
            DASHBOARD UMKM
            <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#2D5F4C", fontSize: 11 }}>
              <Wifi size={12} /> LIVE
            </span>
          </div>
          <h1 className="display" style={{ fontSize: 34, fontWeight: 800, margin: 0, lineHeight: 1.1 }}>
            Warung Mas Erik
          </h1>
          <p style={{ margin: "6px 0 0", color: "#4A5C4A", fontSize: 15 }}>
            Catat penjualan, lihat tren, dan dapatkan penjelasan sederhana — bukan cuma angka.
          </p>
        </div>
      </header>

      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "28px 20px 60px" }}>
        {errorMsg && (
          <div style={{ background: "#FDECEA", border: "1.5px solid #C94A3B", color: "#C94A3B", padding: "10px 14px", borderRadius: 10, marginBottom: 16, fontSize: 14 }}>
            {errorMsg}
          </div>
        )}

        <section style={{ background: "#fff", border: "1.5px solid #E8DFC8", borderRadius: 14, padding: 20, marginBottom: 24 }}>
          <h2 className="display" style={{ fontSize: 17, fontWeight: 700, margin: "0 0 14px" }}>
            Catat Penjualan Baru
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
            <input type="date" value={form.tanggal} onChange={(e) => setForm({ ...form, tanggal: e.target.value })} style={inputStyle} />
            <input type="text" placeholder="Nama produk" value={form.produk} onChange={(e) => setForm({ ...form, produk: e.target.value })} style={inputStyle} />
            <input type="number" placeholder="Qty terjual" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} style={inputStyle} />
            <input type="number" placeholder="Harga satuan (Rp)" value={form.harga} onChange={(e) => setForm({ ...form, harga: e.target.value })} style={inputStyle} />
            <button onClick={tambahData} style={btnPrimary}>
              <Plus size={16} /> Tambah
            </button>
          </div>

          {loadingData ? (
            <div style={{ marginTop: 16, color: "#4A5C4A", fontSize: 14 }}>Memuat data...</div>
          ) : (
            data.length > 0 && (
              <div style={{ marginTop: 16, maxHeight: 160, overflowY: "auto" }}>
                {data.slice().reverse().map((d) => (
                  <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 4px", borderBottom: "1px solid #F0EAD9", fontSize: 14 }}>
                    <span>
                      <strong>{d.tanggal}</strong> — {d.produk} × {d.qty} @ {fmtRupiah(d.harga)}
                    </span>
                    <button onClick={() => hapusData(d.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#C94A3B", padding: 4 }}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )
          )}
        </section>

        {ringkasan && (
          <>
            <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 24 }}>
              <div style={cardStyle}>
                <div style={{ fontSize: 13, color: "#4A5C4A", marginBottom: 4 }}>Total Omzet</div>
                <div className="display" style={{ fontSize: 26, fontWeight: 800 }}>{fmtRupiah(ringkasan.totalOmzet)}</div>
                {ringkasan.tren !== null && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6, fontSize: 13, color: ringkasan.tren >= 0 ? "#2D5F4C" : "#C94A3B" }}>
                    {ringkasan.tren >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    {Math.abs(ringkasan.tren).toFixed(0)}% dari awal ke akhir periode
                  </div>
                )}
              </div>

              <div style={cardStyle}>
                <div style={{ fontSize: 13, color: "#4A5C4A", marginBottom: 4 }}>Produk Terlaris</div>
                <div className="display" style={{ fontSize: 20, fontWeight: 700 }}>{ringkasan.produkTerlaris[0]}</div>
                <div style={{ fontSize: 13, color: "#4A5C4A", marginTop: 4 }}>{ringkasan.produkTerlaris[1].qty} unit terjual</div>
              </div>

              <div style={{ ...cardStyle, borderColor: ringkasan.produkMenurun ? "#C94A3B" : "#E8DFC8" }}>
                <div style={{ fontSize: 13, color: "#4A5C4A", marginBottom: 4, display: "flex", alignItems: "center", gap: 5 }}>
                  <Package size={14} /> Perlu Perhatian
                </div>
                {ringkasan.produkMenurun ? (
                  <div className="display" style={{ fontSize: 16, fontWeight: 700, color: "#C94A3B" }}>{ringkasan.produkMenurun[0]} turun tajam</div>
                ) : (
                  <div style={{ fontSize: 14, color: "#4A5C4A" }}>Belum ada masalah terdeteksi</div>
                )}
              </div>
            </section>

            <section style={{ background: "#fff", border: "1.5px solid #E8DFC8", borderRadius: 14, padding: 20, marginBottom: 24 }}>
              <h2 className="display" style={{ fontSize: 17, fontWeight: 700, margin: "0 0 14px" }}>Tren Omzet Harian</h2>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={ringkasan.grafikHarian}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0EAD9" />
                  <XAxis dataKey="tanggal" stroke="#4A5C4A" fontSize={12} />
                  <YAxis stroke="#4A5C4A" fontSize={12} tickFormatter={(v) => `${v / 1000}rb`} />
                  <Tooltip formatter={(v) => fmtRupiah(v)} contentStyle={{ borderRadius: 8, border: "1px solid #E8DFC8" }} />
                  <Bar dataKey="omzet" fill="#E8935C" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </section>

            <section style={{ background: "#FFFCF5", border: "2px dashed #E8935C", borderRadius: 14, padding: 22, marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <Sparkles size={18} color="#E8935C" />
                <h2 className="display" style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Catatan dari Asisten AI</h2>
              </div>

              {!narasi && !loadingNarasi && (
                <button onClick={generateNarasi} style={btnPrimary}>
                  <Sparkles size={16} /> Buat Penjelasan
                </button>
              )}

              {loadingNarasi && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#4A5C4A" }}>
                  <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
                  Sedang menyusun penjelasan...
                </div>
              )}

              {narasi && !loadingNarasi && (
                <>
                  <p style={{ fontSize: 15.5, lineHeight: 1.65, margin: 0, fontStyle: "italic" }}>{narasi}</p>
                  <button onClick={generateNarasi} style={{ ...btnGhost, marginTop: 14 }}>Buat ulang</button>
                </>
              )}
            </section>

            <section style={{ background: "#fff", border: "1.5px solid #E8DFC8", borderRadius: 14, padding: 20 }}>
              <h2 className="display" style={{ fontSize: 17, fontWeight: 700, margin: "0 0 14px" }}>Tanya Soal Data Tokomu</h2>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  placeholder="Contoh: kenapa Es Teh jarang laku?"
                  value={pertanyaan}
                  onChange={(e) => setPertanyaan(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && tanyaAI()}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button onClick={tanyaAI} disabled={loadingJawaban} style={btnPrimary}>
                  {loadingJawaban ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={16} />}
                </button>
              </div>
              {jawaban && (
                <div style={{ marginTop: 14, padding: 14, background: "#FDF8F0", borderRadius: 10, fontSize: 14.5, lineHeight: 1.6 }}>
                  {jawaban}
                </div>
              )}
            </section>
          </>
        )}

        {!loadingData && data.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: "#4A5C4A" }}>
            Belum ada data penjualan. Tambahkan data pertamamu di atas.
          </div>
        )}
      </main>
    </div>
  );
}

const inputStyle = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1.5px solid #E8DFC8",
  fontSize: 14,
  fontFamily: "inherit",
  background: "#FFFCF5",
  color: "#1A2E1A",
};

const btnPrimary = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  padding: "10px 16px",
  borderRadius: 8,
  border: "none",
  background: "#1A2E1A",
  color: "#FDF8F0",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

const btnGhost = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1.5px solid #E8935C",
  background: "none",
  color: "#E8935C",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

const cardStyle = {
  background: "#fff",
  border: "1.5px solid #E8DFC8",
  borderRadius: 14,
  padding: 18,
};
