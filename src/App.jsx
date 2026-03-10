import React, { useEffect, useMemo, useState } from "react";
import { deepClone } from './safeClone.js';
// --- Abre una ventana emergente con la misma app mostrando 1 sola sección (?mini=...) ---
function openPopup(view) {
  // arma la URL actual + ?mini=...
  const url = new URL(window.location.href);
  url.searchParams.set('mini', view);

  // popup con nombre por vista (reutiliza la misma ventana si ya está abierta)
  const features = [
    'width=980',
    'height=720',
    'menubar=no',
    'toolbar=no',
    'location=no',
    'status=no',
    'resizable=yes',
    'scrollbars=yes'
  ].join(',');

  window.open(url.toString(), `mini-${view}`, features);
}
/**
 * Control de Billar — App.jsx (versión con botón “+ Producto” y modal integrado)
 *
 * - Mantiene lógica de mesas, inventario, caja, reportes y ticket.
 * - Corrige: ordenar hooks, usar `cur.movements` en cerrarCaja(), y JSX balanceado.
 * - Reemplaza botones sueltos de productos por un botón “+ Producto” que abre un Modal (incluido abajo).
 */

// ======= Utilidades =======
const bs = (n) => `Bs ${Number(n || 0).toFixed(2)}`;
const to2 = (n) => Number(n || 0).toFixed(2);
const fmtTime = (d) => new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtTimeSec = (d) => new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtDate = (d) => new Date(d).toLocaleDateString();
const fmtISODate = (d) => new Date(d).toISOString().slice(0, 10);
const nowTs = () => Date.now();

function computeCharge({ start, end, ratePerHour, minMinutes, fractionMinutes, pausedMs = 0 }) {
  const effectiveMs = Math.max(0, (end - start) - Math.max(0, pausedMs));
  const minutes = Math.max(0, Math.ceil(effectiveMs / 60000));
  const rounded = Math.max(minMinutes, Math.ceil(minutes / fractionMinutes) * fractionMinutes);
  const perMinute = ratePerHour / 60;
  const amount = perMinute * rounded;
  return { minutes, rounded, amount };
}

function uid(prefix = "id") { return `${prefix}_${Math.random().toString(36).slice(2, 9)}`; }
function toCSV(rows) { const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`; return rows.map((r) => r.map(escape).join(",")).join("\n"); }
// Regla redondeo total: <0.49 piso; >=0.50 techo
function roundBs(amount) {
  const n = Number(amount || 0);
  const dec = n - Math.floor(n);
  if (dec === 0) return Math.floor(n);
  if (dec < 0.49) return Math.floor(n);
  if (dec < 0.50) return Math.floor(n);
  return Math.ceil(n);
}

// ======= Datos iniciales =======
const defaultBranches = [ { id: "jade", name: "BILLAR JADE" }, { id: "anexo", name: "BILLAR JADE ANEXO" } ];
function makeDefaultTables(n = 10) { return Array.from({ length: n }, (_, i) => ({ id: uid("mesa"), name: `Mesa ${i + 1}`, status: "libre", session: null })); }
const defaultInventory = [
  { id: uid("item"), name: "Tiza", stock: 50, price: 2.0, cost: 0.8, unit: "u" },
  { id: uid("item"), name: "Bebida", stock: 40, price: 10.0, cost: 6.0, unit: "bot" },
  { id: uid("item"), name: "Snack", stock: 30, price: 8.0, cost: 4.0, unit: "u" },
];
const defaultConfig = {
  ratePerHour: 15,
  fractionMinutes: 5,
  minMinutes: 30,
  currency: "Bs",
  tablesPerBranch: 10,
  roundingEnabled: true,
  ticketHeader: "",
  ticketLogo: "",
  agentPrintEnabled: false,
  supervisorPin: "4321",
};

// ======= Persistencia local =======
const LS_KEY = "billiards_app_state_v4";
const AUTH_KEY = "billiards_app_auth_v4";
const USERS_KEY = "billiards_app_users_v4";

function loadState() { try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; } }
function saveState(state) { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch {} }
function loadAuth() { try { const raw = localStorage.getItem(AUTH_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; } }
function saveAuth(auth) { try { localStorage.setItem(AUTH_KEY, JSON.stringify(auth)); } catch {} }
function loadUsers() { try { const raw = localStorage.getItem(USERS_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; } }
function saveUsers(users) { try { localStorage.setItem(USERS_KEY, JSON.stringify(users)); } catch {} }

const DEFAULT_USERS = [
  { id: uid("usr"), username: "admin", password: "123456", role: "Administrador", branchId: "jade", active: true },
  { id: uid("usr"), username: "cajero", password: "123456", role: "Cajero", branchId: "jade", active: true },
];

// ======= App principal =======
export default function App() {
  // Auth
  const [authUser, setAuthUser] = useState(() => loadAuth());
  const [users, setUsers] = useState(() => loadUsers() || DEFAULT_USERS);
  useEffect(() => saveUsers(users), [users]);
  useEffect(() => saveAuth(authUser), [authUser]);

  // Estado general
  const [branches, setBranches] = useState(defaultBranches);
  const [selectedBranchId, setSelectedBranchId] = useState(() => authUser?.role === 'Cajero' ? (authUser.branchId || defaultBranches[0].id) : defaultBranches[0].id);
  const [config, setConfig] = useState(defaultConfig);
  const [byBranch, setByBranch] = useState(() => {
    const init = {};
    for (const b of defaultBranches) {
      init[b.id] = {
        tables: makeDefaultTables(defaultConfig.tablesPerBranch),
        inventory: [...defaultInventory],
        kardex: [],
        cash: { currentShift: null, shifts: [], closures: [] },
        sessions: [],
      };
    }
    return init;
  });

  // Cargar estado previo (si existe)
  useEffect(() => {
    const stored = loadState();
    if (stored && typeof stored === 'object') {
      try {
        if (stored.branches) setBranches(stored.branches);
        if (stored.selectedBranchId) setSelectedBranchId(stored.selectedBranchId);
        if (stored.config) setConfig(stored.config);
        if (stored.byBranch) setByBranch(stored.byBranch);
      } catch(e){ console.warn('Estado previo no válido, se ignora.') }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { saveState({ authUser, branches, selectedBranchId, config, byBranch }); }, [authUser, branches, selectedBranchId, config, byBranch]);

  const selectedBranch = branches.find((b) => b.id === selectedBranchId) || branches[0] || { id: 'jade', name: 'BILLAR JADE' };
  const branchState = byBranch[selectedBranchId] || { tables: [], inventory: [...defaultInventory], kardex: [], cash: { currentShift: null, shifts: [], closures: [] }, sessions: [] };

  // Reloj
  const [tick, setTick] = useState(nowTs());
  useEffect(() => { const t = setInterval(() => setTick(nowTs()), 1000); return () => clearInterval(t); }, []);

  // ======= Helpers de actualización segura =======
  const updateByBranch = (updater) => {
    setByBranch((prev) => {
      const base = deepClone(prev || {});
      const res = updater(base) || base;
      return res;
    })
  }

  // ======= Inventario & Kardex =======
  const pushKardex = (st, { itemId, name, type, qty, unitCost, ref }) => {
    st.kardex.push({ id: uid('kx'), itemId, name, at: nowTs(), type, qty, unitCost: Number(unitCost || 0), ref });
  };
  const ingresoStock = (item, qty, unitCost) => {
    updateByBranch((copy) => {
      const st = copy[selectedBranchId] || (copy[selectedBranchId] = deepClone(branchState));
      const inv = st.inventory.find((x) => x.id === item.id); if (!inv) return copy;
      const curVal = inv.cost * inv.stock;
      const newStock = inv.stock + qty;
      const newCost = newStock > 0 ? (curVal + (qty * unitCost)) / newStock : inv.cost;
      inv.stock = newStock; inv.cost = Number(newCost.toFixed(4));
      pushKardex(st, { itemId: inv.id, name: inv.name, type: 'Ingreso', qty, unitCost, ref: null });
      return copy;
    });
  };
  const egresoStockManual = (item, qty, note = 'Ajuste') => {
    updateByBranch((copy) => {
      const st = copy[selectedBranchId] || (copy[selectedBranchId] = deepClone(branchState));
      const inv = st.inventory.find((x) => x.id === item.id); if (!inv) return copy;
      inv.stock = Math.max(0, inv.stock - qty);
      pushKardex(st, { itemId: inv.id, name: inv.name, type: note, qty: -qty, unitCost: inv.cost, ref: null });
      return copy;
    });
  };

  // ======= Mesas =======
  const startTable = (tableId) => {
    updateByBranch((copy) => {
      const st = copy[selectedBranchId] || (copy[selectedBranchId] = deepClone(branchState));
      const t = st.tables.find((x) => x.id === tableId);
      if (!t || t.status === "ocupada") return copy;
      t.status = "ocupada";
      t.session = { id: uid("ses"), start: nowTs(), customerName: "", items: [], notes: "", createdBy: authUser?.username, pausedMs: 0, isPaused: false, pausedAt: null, discountTotal: 0 };
      return copy;
    });
  };

  const pauseResumeTable = (tableId) => {
    updateByBranch((copy) => {
      const st = copy[selectedBranchId] || (copy[selectedBranchId] = deepClone(branchState));
      const t = st.tables.find((x) => x.id === tableId);
      if (!t || t.status !== 'ocupada' || !t.session) return copy;
      if (!t.session.isPaused) { t.session.isPaused = true; t.session.pausedAt = nowTs(); }
      else { t.session.isPaused = false; t.session.pausedMs += (nowTs() - (t.session.pausedAt || nowTs())); t.session.pausedAt = null; }
      return copy;
    });
  };

  const moveSessionToTable = (fromId) => {
    const toName = prompt('Mover a mesa (nombre exacto, ej.: "Mesa 5")');
    if (!toName) return;
    updateByBranch((copy) => {
      const st = copy[selectedBranchId] || (copy[selectedBranchId] = deepClone(branchState));
      const from = st.tables.find((x) => x.id === fromId);
      const to = st.tables.find((x) => x.name.trim().toLowerCase() === toName.trim().toLowerCase());
      if (!from || !to) { alert('Mesa destino no encontrada'); return copy; }
      if (to.status !== 'libre') { alert('La mesa destino no está libre'); return copy; }
      to.status = 'ocupada'; to.session = from.session; from.status = 'libre'; from.session = null; alert(`Consumo movido a ${to.name}`);
      return copy;
    });
  };

  const addItemToTable = (tableId, itemId) => {
    updateByBranch((copy) => {
      const st = copy[selectedBranchId] || (copy[selectedBranchId] = deepClone(branchState));
      const t = st.tables.find((x) => x.id === tableId);
      const inv = st.inventory.find((i) => i.id === itemId);
      if (!t || t.status !== "ocupada" || !inv || inv.stock <= 0) return copy;
      inv.stock -= 1;
      const existing = t.session.items.find((it) => it.itemId === itemId);
      if (existing) { existing.qty += 1; existing.cost = inv.cost; }
      else t.session.items.push({ itemId, name: inv.name, price: inv.price, cost: inv.cost, qty: 1, disc: 0 });
      pushKardex(st, { itemId: inv.id, name: inv.name, type: 'Venta', qty: -1, unitCost: inv.cost, ref: t.session.id });
      return copy;
    });
  };
  const removeItemFromTable = (tableId, itemId) => {
    updateByBranch((copy) => {
      const st = copy[selectedBranchId] || (copy[selectedBranchId] = deepClone(branchState));
      const t = st.tables.find((x) => x.id === tableId);
      const inv = st.inventory.find((i) => i.id === itemId);
      const existing = t.session.items.find((it) => it.itemId === itemId);
      if (!t || t.status !== "ocupada" || !existing) return copy;
      existing.qty -= 1;
      if (inv) inv.stock += 1;
      pushKardex(st, { itemId: inv?.id || itemId, name: inv?.name || '—', type: 'Devolución', qty: +1, unitCost: inv?.cost ?? 0, ref: t.session.id });
      if (existing.qty <= 0) t.session.items = t.session.items.filter((it) => it.itemId !== itemId);
      return copy;
    });
  };

  const applyItemDiscount = (tableId, itemId, pin) => {
    if (pin !== config.supervisorPin) { alert('PIN incorrecto'); return; }
    const val = Number(prompt('Descuento por ÍTEM (Bs):', '0') || 0);
    updateByBranch((copy) => {
      const st = copy[selectedBranchId] || (copy[selectedBranchId] = deepClone(branchState));
      const t = st.tables.find((x) => x.id === tableId);
      if (!t || !t.session) return copy;
      const it = t.session.items.find((x) => x.itemId === itemId); if (!it) return copy;
      it.disc = Math.max(0, val);
      return copy;
    });
  };
  const applyMesaDiscount = (tableId, pin) => {
    if (pin !== config.supervisorPin) { alert('PIN incorrecto'); return; }
    const val = Number(prompt('Descuento TOTAL de la mesa (Bs):', '0') || 0);
    updateByBranch((copy) => {
      const st = copy[selectedBranchId] || (copy[selectedBranchId] = deepClone(branchState));
      const t = st.tables.find((x) => x.id === tableId);
      if (!t || !t.session) return copy;
      t.session.discountTotal = Math.max(0, val);
      return copy;
    });
  };

  const stopTable = (tableId, { imprimir = true } = {}) => {
    updateByBranch((copy) => {
      const st = copy[selectedBranchId] || (copy[selectedBranchId] = deepClone(branchState));
      const t = st.tables.find((x) => x.id === tableId);
      if (!t || t.status !== "ocupada") return copy;
      if (t.session.isPaused) {
        t.session.isPaused = false;
        t.session.pausedMs += (nowTs() - (t.session.pausedAt || nowTs()));
        t.session.pausedAt = null;
      }
      const end = nowTs();
      const tarifa = computeCharge({
        start: t.session.start, end,
        ratePerHour: config.ratePerHour,
        minMinutes: config.minMinutes,
        fractionMinutes: config.fractionMinutes,
        pausedMs: t.session.pausedMs
      });
      const productosBruto = t.session.items.reduce((acc, it) => acc + (it.price * it.qty), 0);
      const productosDesc = t.session.items.reduce((acc, it) => acc + Math.min(it.disc || 0, it.price * it.qty), 0);
      const productosNeto = Math.max(0, productosBruto - productosDesc);
      const costoProductos = t.session.items.reduce((a, it) => a + (it.cost * it.qty), 0);
      const subtotal = tarifa.amount + productosNeto;
      const totalBruto = subtotal - (t.session.discountTotal || 0);
      const totalCobrar = config.roundingEnabled ? roundBs(totalBruto) : totalBruto;
      const margin = (tarifa.amount + productosNeto) - costoProductos;

      const closed = {
        id: t.session.id,
        branchId: selectedBranchId,
        branchName: selectedBranch?.name || "",
        tableId: t.id,
        tableName: t.name,
        start: t.session.start,
        end,
        pausedMs: t.session.pausedMs,
        tariff: tarifa,
        items: t.session.items,
        productosBruto: Number(to2(productosBruto)),
        productosDesc: Number(to2(productosDesc)),
        productosNeto: Number(to2(productosNeto)),
        costoProductos: Number(to2(costoProductos)),
        discountMesa: Number(to2(t.session.discountTotal || 0)),
        totalRaw: Number(to2(totalBruto)),
        total: Number(to2(totalCobrar)),
        margin: Number(to2(margin)),
        customerName: t.session.customerName || "",
        openedBy: t.session.createdBy || "",
        closedBy: authUser?.username || "",
        roundingApplied: config.roundingEnabled,
      };

      st.sessions.push(closed);
      if (st.cash.currentShift) {
        st.cash.currentShift.movements.push({
          id: uid("mov"), type: "venta", at: end,
          concept: `Consumo ${t.name}`, amount: closed.total, by: authUser?.username || "",
          data: { sessionId: closed.id, tableName: t.name }
        });
      }
      t.status = "libre"; t.session = null;
      if (imprimir) setTimeout(() => openTicket(closed, selectedBranch?.name || ""), 60);
      return copy;
    });
  };

  // ======= Caja =======
  const abrirCaja = (initialCash) => {
    updateByBranch((copy) => {
      const st = copy[selectedBranchId] || (copy[selectedBranchId] = deepClone(branchState));
      if (st.cash.currentShift) return copy;
      st.cash.currentShift = { id: uid("turno"), openedAt: nowTs(), openedBy: authUser?.username || "", initialCash: Number(initialCash) || 0, movements: [] };
      return copy;
    });
  };
  const movimientoCaja = (type, concept, amount) => {
    updateByBranch((copy) => {
      const st = copy[selectedBranchId] || (copy[selectedBranchId] = deepClone(branchState));
      if (!st.cash.currentShift) return copy;
      st.cash.currentShift.movements.push({ id: uid("mov"), type, at: nowTs(), concept, amount: Number(amount) || 0, by: authUser?.username || "" });
      return copy;
    });
  };
  const cerrarCaja = () => {
    updateByBranch((copy) => {
      const st = copy[selectedBranchId] || (copy[selectedBranchId] = deepClone(branchState));
      if (!st.cash.currentShift) return copy;
      const cur = st.cash.currentShift;
      cur.closedAt = nowTs(); cur.closedBy = authUser?.username || "";

      const ingresos = cur.movements
        .filter((m) => m.type === "venta" || m.type === "ingreso")
        .reduce((a, m) => a + m.amount, 0);
      const egresos = cur.movements
        .filter((m) => m.type === "egreso")
        .reduce((a, m) => a + m.amount, 0);
      const totalCaja = cur.initialCash + ingresos - egresos;
      const ventas = cur.movements.filter((m) => m.type === "venta");

      const cierre = {
        id: uid("cierre"),
        branchId: selectedBranchId,
        branchName: selectedBranch?.name || "",
        openedAt: cur.openedAt, closedAt: cur.closedAt,
        openedBy: cur.openedBy, closedBy: cur.closedBy,
        initialCash: cur.initialCash, ingresos, egresos, totalCaja,
        ventasCount: ventas.length, ventasTotal: ventas.reduce((a, m) => a + m.amount, 0)
      };
      st.cash.shifts.push(cur); st.cash.closures.push(cierre); st.cash.currentShift = null;
      return copy;
    });
  };

  const cajaResumen = useMemo(() => {
    const st = branchState; if (!st) return null;
    const turno = st.cash.currentShift; if (!turno) return null;
    const ingresos = turno.movements.filter((m) => m.type === "venta" || m.type === "ingreso").reduce((a, m) => a + m.amount, 0);
    const egresos = turno.movements.filter((m) => m.type === "egreso").reduce((a, m) => a + m.amount, 0);
    const totalCaja = turno.initialCash + ingresos - egresos;
    return { ingresos, egresos, totalCaja };
  }, [branchState]);

  // ======= Ticket & Agente =======
  const [ticketData, setTicketData] = useState(null);
  function openTicket(data, branchName) {
    const withBranch = { ...data, branchName };
    setTicketData(withBranch);
    if (config.agentPrintEnabled) {
      tryAgentPrint(withBranch).catch(() => window.print());
    } else {
      setTimeout(() => window.print(), 80);
    }
  }
  async function tryAgentPrint(payload) {
    try {
      const res = await fetch('http://localhost:18401/print', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'billar_ticket_v1', payload })
      });
      if (!res.ok) throw new Error('Agente no respondió');
    } catch (e) { throw e; }
  }

  // ======= Reportes (rango y filtros) =======
  const [reportFilter, setReportFilter] = useState(() => ({ from: fmtISODate(Date.now()), to: fmtISODate(Date.now()), cashier: '', table: '', product: '' }));
  const reportData = useMemo(() => {
    const st = branchState; if (!st) return { sessions: [], totals: { tiempo: 0, productos: 0, total: 0, margen: 0 }, prodAgg: [], byCashier: [], byTable: [] };
    const from = new Date(`${reportFilter.from}T00:00:00`).getTime();
    const to = new Date(`${reportFilter.to}T23:59:59`).getTime();
    const sessions = st.sessions.filter((s) => s.end >= from && s.end <= to)
      .filter((s) => (reportFilter.cashier ? s.closedBy === reportFilter.cashier : true))
      .filter((s) => (reportFilter.table ? s.tableName === reportFilter.table : true))
      .filter((s) => (reportFilter.product ? s.items.some((it) => it.name === reportFilter.product) : true));
    const tiempo = sessions.reduce((a, s) => a + s.tariff.rounded, 0);
    const productos = sessions.reduce((a, s) => a + s.productosNeto, 0);
    const total = sessions.reduce((a, s) => a + s.total, 0);
    const margen = sessions.reduce((a, s) => a + s.margin, 0);

    // Agregado por producto
    const prodMap = new Map();
    for (const s of sessions) {
      for (const it of s.items) {
        const key = it.name;
        const agg = prodMap.get(key) || { name: key, qty: 0, venta: 0, costo: 0, margen: 0 };
        agg.qty += it.qty;
        agg.venta += (it.price * it.qty) - (it.disc || 0);
        agg.costo += (it.cost * it.qty);
        agg.margen += ((it.price * it.qty) - (it.disc || 0) - (it.cost * it.qty));
        prodMap.set(key, agg);
      }
    }
    const prodAgg = Array.from(prodMap.values());

    // Por cajero
    const cashMap = new Map();
    for (const s of sessions) {
      const k = s.closedBy || '—';
      const a = cashMap.get(k) || { cajero: k, ventas: 0 };
      a.ventas += s.total;
      cashMap.set(k, a);
    }
    const byCashier = Array.from(cashMap.values());

    // Por mesa
    const tbMap = new Map();
    for (const s of sessions) {
      const k = s.tableName;
      const a = tbMap.get(k) || { mesa: k, ventas: 0 };
      a.ventas += s.total;
      tbMap.set(k, a);
    }
    const byTable = Array.from(tbMap.values());

    return { sessions, totals: { tiempo, productos, total, margen }, prodAgg, byCashier, byTable };
  }, [branchState, reportFilter]);

  // ======= Usuarios (admin) =======
  const createUser = () => {
    const username = prompt('Usuario:'); if (!username) return;
    const password = prompt('Contraseña inicial:') || '123456';
    const role = prompt('Rol (Administrador/Cajero):', 'Cajero') || 'Cajero';
    const branchId = prompt('Sucursal (id):', selectedBranchId) || selectedBranchId;
    setUsers((prev) => [...(prev || []), { id: uid('usr'), username, password, role, branchId, active: true }]);
  };
  const changePassword = (u) => {
    const np = prompt(`Nueva contraseña para ${u.username}:`, ''); if (!np) return;
    setUsers((prev) => (prev || []).map((x) => x.id === u.id ? { ...x, password: np } : x));
  };
  const toggleUser = (u) => {
    setUsers((prev) => (prev || []).map((x) => x.id === u.id ? { ...x, active: !x.active } : x));
  };

  // Hooks dependientes del auth (antes del Gate)
  const canEditTariff = authUser?.role === "Administrador";
  const isCajero = authUser?.role === 'Cajero';
  useEffect(() => { if (isCajero && authUser?.branchId) setSelectedBranchId(authUser.branchId); }, [isCajero, authUser]);

  // Gate de Login
  if (!authUser) {
    return (
      <LoginScreen
        onLogin={(username, password) => {
          const found = (users || []).find((x) => x.username === username && x.password === password && x.active);
          if (found) {
            setAuthUser({ username: found.username, role: found.role, branchId: found.branchId });
            setSelectedBranchId(found.role === 'Cajero' ? found.branchId : selectedBranchId);
          } else {
            alert('Usuario o contraseña incorrectos');
          }
        }}
        onInitAdmin={() => setUsers(DEFAULT_USERS)}
      />
    );
  }
// Detectar modo 'mini' (solo una tarjeta en la ventana emergente)
const params = new URLSearchParams(window.location.search);
const mini = params.get('mini'); // 'inventory' | 'reports' | 'config' | 'users'

if (mini && authUser) {
  const miniShell = (children, title) => (
    <div className="min-h-screen bg-neutral-50 p-3">
      <header className="sticky top-0 z-10 bg-white/85 backdrop-blur shadow-sm mb-3">
        <div className="max-w-4xl mx-auto p-3 flex items-center justify-between">
          <h1 className="text-lg font-semibold">{title}</h1>
          <div className="text-xs text-neutral-600">
            {authUser.username} ({authUser.role})
          </div>
        </div>
      </header>
      <main className="max-w-4xl mx-auto">{children}</main>
    </div>
  );

  if (mini === 'inventory') {
    return miniShell(
      <InventoryCard
        branchState={branchState}
        setByBranch={setByBranch}
        selectedBranchId={selectedBranchId}
        ingresoStock={ingresoStock}
        egresoStockManual={egresoStockManual}
      />,
      'Inventario'
    );
  }

  if (mini === 'reports') {
    return miniShell(
      <ReportsCard
        branchState={branchState}
        selectedBranch={selectedBranch}
        reportFilter={reportFilter}
        setReportFilter={setReportFilter}
        reportData={reportData}
      />,
      'Reportes'
    );
  }

  if (mini === 'config') {
    return miniShell(
      <div className="bg-white rounded-2xl shadow-sm border p-4">
        ...
      </div>,
      'Configuración'
    );
  }

  if (mini === 'users') {
    return miniShell(
      <div className="bg-white rounded-2xl shadow-sm border p-4">
        ...
      </div>,
      'Usuarios'
    );
  }
}
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-white/85 backdrop-blur shadow-sm">
        <div className="max-w-7xl mx-auto p-3 flex flex-wrap gap-3 items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Control de Billar</h1>
            <span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs border">{selectedBranch?.name}</span>
            <select className="border rounded-lg px-2 py-1 text-sm" value={selectedBranchId} disabled={isCajero} onChange={(e) => setSelectedBranchId(e.target.value)}>
              {branches.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
            </select>
          </div>
          <Clock tick={tick} />
          <div className="flex items-center gap-2 ml-4">
            <span className="text-xs text-neutral-500">{authUser.username} ({authUser.role})</span>
            <button className="border px-2 py-1 rounded-lg text-xs" onClick={() => setAuthUser(null)}>Salir</button>
          </div>
        </div>
      </header>

      {/* Contenido */}
      <main className="max-w-7xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Mesas */}
        <section className="lg:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-semibold">Mesas</h2>
            <div className="flex gap-2">
              <button
                onClick={() => updateByBranch((prev) => {
                  const copy = deepClone(prev);
                  (copy[selectedBranchId] ||= deepClone(branchState))
                    .tables.push({ id: uid("mesa"), name: `Mesa ${(copy[selectedBranchId].tables.length) + 1}`, status: 'libre', session: null });
                  return copy;
                })}
                className="px-3 py-1.5 rounded-xl bg-white border shadow-sm text-sm hover:bg-neutral-50"
              >
                + Mesa
              </button>
            </div>
          </div>

          {/* Reja de mesas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {(branchState.tables || []).map((t) => (
              <MesaCard
                key={t.id}
                table={t}
                config={config}
                onStart={() => startTable(t.id)}
                onStop={() => stopTable(t.id)}
                onRename={(name) => updateByBranch((prev) => {
                  const copy = deepClone(prev);
                  const tab = (copy[selectedBranchId] ||= deepClone(branchState)).tables.find((x) => x.id === t.id);
                  if (tab) tab.name = name;
                  return copy;
                })}
                inventory={branchState.inventory}
                onAddItem={(itemId) => addItemToTable(t.id, itemId)}
                onRemoveItem={(itemId) => removeItemFromTable(t.id, itemId)}
                onCustomerChange={(name) => updateByBranch((prev) => {
                  const copy = deepClone(prev);
                  const tab = (copy[selectedBranchId] ||= deepClone(branchState)).tables.find((x) => x.id === t.id);
                  if (tab?.session) tab.session.customerName = name;
                  return copy;
                })}
                onPauseResume={() => pauseResumeTable(t.id)}
                onMove={() => moveSessionToTable(t.id)}
                onItemDiscount={(itemId) => applyItemDiscount(t.id, itemId, prompt('PIN Supervisor:') || '')}
                onMesaDiscount={() => applyMesaDiscount(t.id, prompt('PIN Supervisor:') || '')}
              />
            ))}
          </div>
        </section>

        {/* Lateral: 4 accesos (cada uno abre una ventana emergente) */}
<section className="space-y-3">
  <div className="bg-white rounded-2xl shadow-sm border p-4">
    <h3 className="font-semibold mb-2">Accesos rápidos</h3>
    <div className="grid grid-cols-1 gap-2">

      <button
        onClick={() => openPopup('inventory')}
        className="px-3 py-2 rounded-xl bg-white border shadow-sm text-left hover:bg-neutral-50"
      >
        📦 Inventario
        <div className="text-xs text-neutral-500">Abrir ventana emergente</div>
      </button>

      <button
        onClick={() => openPopup('reports')}
        className="px-3 py-2 rounded-xl bg-white border shadow-sm text-left hover:bg-neutral-50"
      >
        📈 Reportes
        <div className="text-xs text-neutral-500">Abrir ventana emergente</div>
      </button>

      <button
        onClick={() => openPopup('config')}
        className="px-3 py-2 rounded-xl bg-white border shadow-sm text-left hover:bg-neutral-50"
      >
        ⚙️ Configuración
        <div className="text-xs text-neutral-500">Abrir ventana emergente</div>
      </button>

      {authUser.role === 'Administrador' && (
        <button
          onClick={() => openPopup('users')}
          className="px-3 py-2 rounded-xl bg-white border shadow-sm text-left hover:bg-neutral-50"
        >
          👤 Usuarios
          <div className="text-xs text-neutral-500">Abrir ventana emergente</div>
        </button>
      )}
    </div>
  </div>

  {/* (Opcional) si quieres mantener “Tarifas” y “Caja” visibles aquí,
      puedes volver a pegarlas debajo de este bloque. Si no, deja solo los 4 botones. */}
</section>
      </main>

      {/* Impresión: Ticket 80 mm */}
      <div aria-hidden className="print:block hidden">
        <div id="ticket" className="ticket w-[80mm] p-3 text-sm font-mono">
          {ticketData && (<Ticket80mm data={ticketData} config={config} />)}
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: 80mm auto; margin: 4mm; }
          body * { visibility: hidden; }
          #ticket, #ticket * { visibility: visible; }
          #ticket { position: absolute; left: 0; top: 0; }
        }
      `}</style>
    </div>
  );
}

function Clock({ tick }){
  return (
    <div className="text-right">
      <div className="text-xl font-mono leading-tight">{fmtTimeSec(tick)}</div>
      <div className="text-xs text-neutral-500 -mt-1">{fmtDate(tick)}</div>
    </div>
  )
}

function MesaCard({
  table, config, onStart, onStop, onRename,
  inventory, onAddItem, onRemoveItem, onCustomerChange,
  onPauseResume, onMove, onItemDiscount, onMesaDiscount
}) {
  const start = table?.session?.start
  const pausedMs = table?.session?.pausedMs
  const isPaused = table?.session?.isPaused
  const pausedAt = table?.session?.pausedAt
  const [t, setT] = useState(0)
  const [showPicker, setShowPicker] = useState(false)

  useEffect(() => { const i = setInterval(() => setT(Date.now()), 1000); return () => clearInterval(i) }, [])
  const tarifa = useMemo(() => {
    if (!table.session) return null;
    const extraPause = isPaused ? (Date.now() - (pausedAt || Date.now())) : 0;
    return computeCharge({
      start: start, end: Date.now(),
      ratePerHour: config.ratePerHour, minMinutes: config.minMinutes, fractionMinutes: config.fractionMinutes,
      pausedMs: (pausedMs || 0) + extraPause
    });
  }, [table.session, config, t, isPaused, pausedAt, pausedMs, start]);

  return (
    <div className={`rounded-2xl border shadow-sm p-3 ${table.status === "ocupada" ? "bg-emerald-50 border-emerald-200" : "bg-white"}`}>
      <div className="flex items-center justify-between mb-2">
        <input className="font-semibold bg-transparent focus:outline-none rounded px-1 hover:bg-neutral-100" value={table.name} onChange={(e) => onRename(e.target.value)} />
        <span className={`text-xs px-2 py-0.5 rounded-full border ${table.status === "ocupada" ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-700"}`}>{table.status}</span>
      </div>

      {table.status === "libre" && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-neutral-600">Lista para usar</span>
          <button className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-sm" onClick={onStart}>Iniciar</button>
        </div>
      )}

      {table.status === "ocupada" && table.session && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 text-sm">
            {/* Columna izquierda */}
            <div className="bg-white rounded-xl p-2 border">
              <div className="flex justify-between"><span>Inicio</span><b>{fmtTime(table.session.start)}</b></div>
              <div className="flex justify-between">
                <span>Cronómetro</span>
                <b>{(() => {
                  const ms = Math.max(0, (Date.now() - start - (pausedMs || 0) - (isPaused ? (Date.now() - (pausedAt || Date.now())) : 0)));
                  const sec = Math.floor(ms/1000);
                  const mm = String(Math.floor(sec/60)).padStart(2,'0');
                  const ss = String(sec%60).padStart(2,'0');
                  return `${mm}:${ss}`;
                })()}</b>
              </div>
              <div className="flex justify-between"><span>Facturable</span><b>{tarifa?.rounded ?? 0} min</b></div>
              <div className="flex justify-between"><span>Importe</span><b>{bs(tarifa?.amount ?? 0)}</b></div>
              <div className="flex gap-2 mt-2">
                <button className="px-2 py-1 rounded-lg bg-white border text-xs" onClick={onPauseResume}>{table.session.isPaused ? 'Retomar' : 'Pausar'}</button>
                <button className="px-2 py-1 rounded-lg bg-white border text-xs" onClick={onMove}>Mover consumo</button>
              </div>
              <div className="flex gap-2 mt-2">
                <button className="px-2 py-1 rounded-lg bg-white border text-xs" onClick={onMesaDiscount}>Desc. mesa</button>
              </div>
            </div>

            {/* Columna derecha */}
            <div className="bg-white rounded-xl p-2 border">
              <div className="font-medium mb-1">Cliente</div>
              <input
                className="w-full border rounded-lg px-2 py-1 text-sm mb-2"
                placeholder="Nombre del cliente (opcional)"
                value={table.session.customerName}
                onChange={(e) => onCustomerChange(e.target.value)}
              />

              <div className="font-medium mb-1">Productos</div>
              {/* Botón único para abrir modal */}
              <button className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm mb-2" onClick={() => setShowPicker(true)}>+ Producto</button>

              {/* Lista de items actuales */}
              <div className="space-y-1 max-h-28 overflow-auto pr-1">
                {table.session.items.length === 0 && <div className="text-xs text-neutral-500">Sin productos</div>}
                {table.session.items.map((it) => (
                  <div key={it.itemId} className="grid grid-cols-12 items-center text-xs gap-1">
                    <span className="col-span-6 truncate">{it.name} × {it.qty}</span>
                    <span className="col-span-3 text-right text-neutral-500">{bs(it.price * it.qty)}</span>
                    <div className="col-span-3 flex gap-1 justify-end">
                      <button className="px-2 py-0.5 rounded-lg bg-white border" onClick={() => onRemoveItem(it.itemId)}>-</button>
                      <button className="px-2 py-0.5 rounded-lg bg-white border" onClick={() => onItemDiscount(it.itemId)}>Desc</button>
                    </div>
                    {it.disc > 0 && <div className="col-span-12 text-[10px] text-rose-600">Descuento ítem: {bs(it.disc)}</div>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button className="px-3 py-1.5 rounded-xl bg-white border shadow-sm text-sm" onClick={() => onStop(false)}>Cerrar (sin imprimir)</button>
            <button className="px-3 py-1.5 rounded-xl bg-rose-600 text-white text-sm" onClick={() => onStop(true)}>Cerrar & imprimir</button>
          </div>

          {/* Modal para agregar consumo */}
          {showPicker && (
            <Modal title="Agregar consumo" onClose={() => setShowPicker(false)}>
              <ProductPicker
                inventory={inventory}
                onPick={(it) => { onAddItem(it.id); }}
              />
              <div className="mt-3 flex justify-end gap-2">
                <button className="px-3 py-1.5 rounded-lg border" onClick={() => setShowPicker(false)}>Cerrar</button>
              </div>
            </Modal>
          )}
        </div>
      )}
    </div>
  );
}

// ======= Modal (incluido en este archivo) =======
function Modal({ title = '', onClose, children }) {
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-[min(92vw,700px)] max-h-[88vh] overflow-auto p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button className="px-2 py-1 rounded-lg border" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ======= Selector/Buscador de Productos (incluido en este archivo) =======
function ProductPicker({ inventory = [], onPick }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    const arr = Array.isArray(inventory) ? inventory : [];
    return k ? arr.filter(it => (it?.name || '').toLowerCase().includes(k)) : arr;
  }, [q, inventory]);

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input
          className="border rounded-lg px-3 py-2 w-full"
          placeholder="Buscar producto..."
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>

      <div className="border rounded-xl overflow-hidden">
        <div className="grid grid-cols-12 bg-neutral-50 border-b px-3 py-2 text-xs font-medium">
          <div className="col-span-7">Producto</div>
          <div className="col-span-2 text-right">Precio</div>
          <div className="col-span-1 text-right">Stock</div>
          <div className="col-span-2 text-right">&nbsp;</div>
        </div>

        <div className="max-h-[50vh] overflow-auto">
          {list.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-neutral-500">Sin resultados</div>
          )}
          {list.map(it => (
            <div key={it.id} className="grid grid-cols-12 items-center px-3 py-2 border-b text-sm">
              <div className="col-span-7 truncate" title={it.name}>{it.name}</div>
              <div className="col-span-2 text-right">Bs {Number(it.price || 0).toFixed(2)}</div>
              <div className="col-span-1 text-right">{it.stock}</div>
              <div className="col-span-2 flex justify-end">
                <button
                  disabled={it.stock <= 0}
                  className={`px-2 py-1 rounded-lg border text-sm ${it.stock <= 0 ? 'opacity-60 cursor-not-allowed' : 'bg-emerald-600 text-white border-emerald-600'}`}
                  onClick={() => onPick && onPick(it)}
                >Agregar</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function InventoryCard({ branchState, setByBranch, selectedBranchId, ingresoStock, egresoStockManual }) {
  const [viewKardexFor, setViewKardexFor] = useState('');
  return (
    <div className="bg-white rounded-2xl shadow-sm border p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">Inventario</h3>
        <div className="flex items-center gap-2">
          <button className="px-2 py-1 text-xs rounded-lg bg-sky-50 text-sky-700 border" onClick={() => {
            const name = prompt("Producto:"); if (!name) return;
            const price = Number(prompt("Precio venta (Bs):", "0") || 0);
            const cost = Number(prompt("Precio real/costo (Bs):", "0") || 0);
            const stock = Number(prompt("Stock inicial:", "0") || 0);
            const unit = prompt("Unidad (u, bot, etc):", "u") || "u";
            setByBranch((prev) => {
              const copy = deepClone(prev || {});
              (copy[selectedBranchId] ||= deepClone(branchState)).inventory.push({ id: uid("item"), name, price, cost, stock, unit });
              return copy;
            });
          }}>+ Producto</button>
        </div>
      </div>

      <div className="space-y-1 max-h-60 overflow-auto pr-1">
        {(branchState.inventory || []).map((it) => (
          <div key={it.id} className="grid grid-cols-12 gap-2 items-center text-sm p-2 rounded-xl border hover:bg-neutral-50">
            <div className="col-span-3 font-medium truncate" title={it.name}>{it.name}</div>
            <div className="col-span-2 text-right">Costo: {bs(it.cost)}</div>
            <div className="col-span-2 text-right">Venta: {bs(it.price)}</div>
            <div className="col-span-2 text-right">Ganancia: {bs((it.price - it.cost))}</div>
            <div className="col-span-1 text-right">{it.stock} {it.unit}</div>
            <div className="col-span-2 flex gap-1 justify-end">
              <button className="px-2 py-1 text-xs rounded-lg bg-white border" onClick={() => {
                const name = prompt("Nombre del producto:", it.name) ?? it.name;
                const cost = Number(prompt("Nuevo costo (Bs):", String(it.cost)) ?? it.cost);
                const price = Number(prompt("Nuevo precio venta (Bs):", String(it.price)) ?? it.price);
                const stock = Number(prompt("Ajustar stock (suma/resta):", "0") || 0);
                setByBranch((prev) => {
                  const copy = deepClone(prev || {});
                  const inv = (copy[selectedBranchId] ||= deepClone(branchState)).inventory.find((x) => x.id === it.id);
                  if (!inv) return prev;
                  inv.name = name; inv.cost = cost; inv.price = price; inv.stock = inv.stock + stock;
                  return copy;
                });
              }}>Editar</button>
              <button className="px-2 py-1 text-xs rounded-lg bg-white border" onClick={() => setViewKardexFor(viewKardexFor === it.id ? '' : it.id)}>Kardex</button>
              <button className="px-2 py-1 text-xs rounded-lg bg-white border" onClick={() => {
                const qty = Number(prompt('Ingreso cantidad:', '0') || 0);
                const ucost = Number(prompt('Costo unitario (Bs):', String(it.cost)) || it.cost);
                if (qty > 0) ingresoStock(it, qty, ucost);
              }}>Ingreso</button>
              <button className="px-2 py-1 text-xs rounded-lg bg-white border" onClick={() => {
                const qty = Number(prompt('Egreso/Ajuste cantidad:', '0') || 0);
                if (qty > 0) egresoStockManual(it, qty, 'Ajuste');
              }}>Egreso</button>
            </div>

            {viewKardexFor === it.id && (
              <div className="col-span-12 text-xs border rounded-lg p-2 bg-white">
                <div className="font-medium mb-1">Kardex: {it.name}</div>
                <div className="max-h-40 overflow-auto pr-1 space-y-1">
                  {branchState.kardex.filter((k) => k.itemId === it.id).slice().reverse().map((k) => (
                    <div key={k.id} className="grid grid-cols-5 gap-2 border rounded p-1">
                      <div>{new Date(k.at).toLocaleString()}</div>
                      <div>{k.type}</div>
                      <div>Qty: {k.qty}</div>
                      <div>U$ {bs(k.unitCost)}</div>
                      <div>Ref: {k.ref || '—'}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportsCard({ branchState, selectedBranch, reportFilter, setReportFilter, reportData }){
  return (
    <div className="bg-white rounded-2xl shadow-sm border p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">Reportes</h3>
        <div className="flex flex-wrap gap-2 items-center text-sm">
          <label className="flex items-center gap-1">Desde <input type="date" className="border rounded-lg px-2 py-1" value={reportFilter.from} onChange={(e) => setReportFilter((f) => ({ ...f, from: e.target.value }))} /></label>
          <label className="flex items-center gap-1">Hasta <input type="date" className="border rounded-lg px-2 py-1" value={reportFilter.to} onChange={(e) => setReportFilter((f) => ({ ...f, to: e.target.value }))} /></label>
          <select className="border rounded-lg px-2 py-1" value={reportFilter.cashier} onChange={(e) => setReportFilter((f) => ({ ...f, cashier: e.target.value }))}>
            <option value="">Cajero (todos)</option>
            {Array.from(new Set(branchState.sessions.map((s) => s.closedBy))).filter(Boolean).map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className="border rounded-lg px-2 py-1" value={reportFilter.table} onChange={(e) => setReportFilter((f) => ({ ...f, table: e.target.value }))}>
            <option value="">Mesa (todas)</option>
            {Array.from(new Set(branchState.sessions.map((s) => s.tableName))).map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className="border rounded-lg px-2 py-1" value={reportFilter.product} onChange={(e) => setReportFilter((f) => ({ ...f, product: e.target.value }))}>
            <option value="">Producto (todos)</option>
            {Array.from(new Set(branchState.sessions.flatMap((s) => s.items.map((i) => i.name)))).map((p) => <option key={p}>{p}</option>)}
          </select>
          <button className="px-3 py-1.5 rounded-xl bg-white border shadow-sm" onClick={() => exportReportCSV(branchState, reportData, reportFilter, selectedBranch?.name)}>Exportar CSV</button>
        </div>
      </div>

      <div className="text-sm space-y-1">
        <div className="flex justify-between"><span>Tiempo facturado:</span><span>{reportData.totals.tiempo} min</span></div>
        <div className="flex justify-between"><span>Total productos (neto):</span><span>{bs(reportData.totals.productos)}</span></div>
        <div className="flex justify-between"><span>Margen total:</span><span>{bs(reportData.totals.margen)}</span></div>
        <div className="flex justify-between font-semibold"><span>Total cobrado:</span><span>{bs(reportData.totals.total)}</span></div>
      </div>

      <details className="mt-2" open>
        <summary className="text-sm text-neutral-600 cursor-pointer">Sesiones (detallado)</summary>
        <div className="mt-2 max-h-64 overflow-auto pr-1 space-y-1">
          {reportData.sessions.length === 0 && <div className="text-xs text-neutral-500">Sin sesiones en el rango.</div>}
          {reportData.sessions.map((s) => (
            <div key={s.id} className="text-xs border rounded-lg p-2">
              <div className="grid grid-cols-2 gap-1">
                <div><b>Mesa:</b> {s.tableName}</div>
                <div><b>Cliente:</b> {s.customerName || "—"}</div>
                <div><b>Inicio:</b> {fmtTime(s.start)}</div>
                <div><b>Fin:</b> {fmtTime(s.end)}</div>
                <div><b>Tiempo (min):</b> {s.tariff.rounded}</div>
                <div><b>Tarifa:</b> {bs(s.tariff.amount)}</div>
                <div><b>Prod. bruto:</b> {bs(s.productosBruto)}</div>
                <div><b>Desc. ítems:</b> {bs(s.productosDesc)}</div>
                <div><b>Desc. mesa:</b> {bs(s.discountMesa)}</div>
                <div><b>Prod. neto:</b> {bs(s.productosNeto)}</div>
                <div><b>Costo prod.:</b> {bs(s.costoProductos)}</div>
                <div className="font-semibold"><b>Total cobrado:</b> {bs(s.total)}</div>
                <div><b>Margen (aprox):</b> {bs(s.margin)}</div>
                <div><b>Cerrado por:</b> {s.closedBy || "—"}</div>
              </div>
              <div className="mt-1 flex gap-2 justify-end">
                <button className="px-2 py-1 text-xs rounded-lg bg-white border" onClick={() => openTicket(s, s.branchName || selectedBranch?.name)}>Reimprimir</button>
              </div>
            </div>
          ))}
        </div>
      </details>

      <details className="mt-2">
        <summary className="text-sm text-neutral-600 cursor-pointer">Agregado por producto</summary>
        <div className="mt-2 space-y-1 text-xs max-h-48 overflow-auto pr-1">
          {reportData.prodAgg.map((p) => (
            <div key={p.name} className="grid grid-cols-4 gap-2 border rounded-lg p-2">
              <div><b>{p.name}</b></div><div>Cant: {p.qty}</div><div>Venta: {bs(p.venta)}</div><div>Margen: {bs(p.margen)}</div>
            </div>
          ))}
        </div>
      </details>

      <details className="mt-2">
        <summary className="text-sm text-neutral-600 cursor-pointer">Por cajero</summary>
        <div className="mt-2 space-y-1 text-xs">
          {reportData.byCashier.map((c) => (<div key={c.cajero} className="flex justify-between border rounded-lg p-2"><span>{c.cajero}</span><b>{bs(c.ventas)}</b></div>))}
        </div>
      </details>

      <details className="mt-2">
        <summary className="text-sm text-neutral-600 cursor-pointer">Por mesa</summary>
        <div className="mt-2 space-y-1 text-xs">
          {reportData.byTable.map((r) => (<div key={r.mesa} className="flex justify-between border rounded-lg p-2"><span>{r.mesa}</span><b>{bs(r.ventas)}</b></div>))}
        </div>
      </details>
    </div>
  )
}

function Ticket80mm({ data, config }) {
  return (
    <div className="text-xs leading-5">
      <div className="text-center">
        {config.ticketLogo && <img src={config.ticketLogo} alt="logo" className="mx-auto h-14 object-contain" />}
        <div className="text-base font-bold">{config.ticketHeader || data.branchName}</div>
        <div>Ticket #{data.id?.slice(-6) || ""}</div>
        <div>{new Date(data.end).toLocaleString()}</div>
        <div className="mt-1">{data.tableName}{data.customerName ? ` — ${data.customerName}` : ''}</div>
      </div>
      <div className="mt-2 border-t border-dashed pt-2">
        <div className="flex justify-between"><span>Inicio</span><span>{fmtTime(data.start)}</span></div>
        <div className="flex justify-between"><span>Fin</span><span>{fmtTime(data.end)}</span></div>
        <div className="flex justify-between"><span>Tiempo (min)</span><span>{data.tariff.rounded}</span></div>
        <div className="flex justify-between"><span>Tarifa</span><span>{bs(data.tariff.amount)}</span></div>
      </div>
      <div className="mt-2">
        <div className="font-medium">Productos</div>
        {data.items.length === 0 ? (<div className="text-neutral-500">—</div>) : (
          <div className="space-y-1">
            {data.items.map((it) => (
              <div key={it.itemId} className="flex justify-between">
                <span>{it.name} × {it.qty}{it.disc ? ` (desc ${bs(it.disc)})` : ''}</span>
                <span>{bs(it.price * it.qty - (it.disc || 0))}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-between mt-1"><span>Desc. mesa</span><span>{bs(data.discountMesa)}</span></div>
        <div className="flex justify-between mt-1"><span>Subtotal prod.</span><span>{bs(data.productosNeto)}</span></div>
      </div>
      <div className="mt-2 border-t border-dashed pt-2 text-sm font-semibold flex justify-between">
        <span>Total</span>
        <span>{bs(data.total)}</span>
      </div>
      {data.roundingApplied && <div className="text-center text-[10px] text-neutral-500">* Total redondeado por regla 0.49/0.50</div>}
      <div className="mt-2 text-center">Gracias por su preferencia</div>
    </div>
  );
}

function LoginScreen({ onLogin, onInitAdmin }) {
  const [u, setU] = useState(""); const [p, setP] = useState("");
  return (
    <div className="min-h-screen grid place-items-center bg-neutral-50">
      <div className="w-full max-w-sm bg-white border rounded-2xl shadow-sm p-6">
        <h1 className="text-xl font-semibold text-center">Ingreso al Sistema</h1>
        <p className="text-xs text-neutral-500 text-center mb-4">Use sus credenciales para continuar</p>
        <label className="text-sm flex flex-col mb-2"><span>Usuario</span><input className="border rounded-lg px-3 py-2" value={u} onChange={(e) => setU(e.target.value)} /></label>
        <label className="text-sm flex flex-col mb-3"><span>Contraseña</span><input type="password" className="border rounded-lg px-3 py-2" value={p} onChange={(e) => setP(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onLogin(u, p); }} /></label>
        <button className="w-full px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm hover:bg-emerald-700" onClick={() => onLogin(u, p)}>Ingresar</button>
        <div className="text-[11px] text-neutral-500 mt-3">
          <div><b>Demo:</b> admin/123456 (Administrador) — cajero/123456 (Cajero)</div>
          <button className="mt-2 underline" onClick={onInitAdmin}>Restablecer usuarios demo</button>
        </div>
      </div>
    </div>
  );
}

// ======= Helpers (CSV) =======
function handleLogoUpload(e, setConfig) {
  const file = e.target.files?.[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => setConfig((c) => ({ ...c, ticketLogo: String(ev.target?.result || '') }));
  reader.readAsDataURL(file);
}

function exportReportCSV(branchState, reportData, filter, branchName) {
  const header = [
    "Desde", "Hasta", "Sucursal", "Mesa", "Cliente", "Cajero", "Inicio", "Fin", "Tiempo (min)", "Tarifa (Bs)", "Prod. bruto", "Desc. ítems", "Desc. mesa", "Prod. neto", "Costo prod.", "Margen", "Total cobrado"
  ];
  const rows = reportData.sessions.map((s) => [
    filter.from, filter.to, branchName || '', s.tableName, s.customerName || '', s.closedBy || '', fmtTime(s.start), fmtTime(s.end), s.tariff.rounded, to2(s.tariff.amount), to2(s.productosBruto), to2(s.productosDesc), to2(s.discountMesa), to2(s.productosNeto), to2(s.costoProductos), to2(s.margin), to2(s.total)
  ]);
  const csv = toCSV([header, ...rows]);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = `reporte_${filter.from}_a_${filter.to}_${branchName || ''}.csv`; a.click(); URL.revokeObjectURL(url);
}

function exportClosureCSV(c) {
  const header = ["Sucursal","Apertura","Cierre","Abrió","Cerró","Inicial","Ingresos","Egresos","Total caja","Ventas (cant)","Ventas (Bs)"];
  const row = [
    c.branchName || "",
    new Date(c.openedAt).toLocaleString(),
    new Date(c.closedAt).toLocaleString(),
    c.openedBy || "",
    c.closedBy || "",
    to2(c.initialCash), to2(c.ingresos), to2(c.egresos), to2(c.totalCaja),
    c.ventasCount || 0, to2(c.ventasTotal || 0)
  ];
  const csv = toCSV([header, row]);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = `cierre_${(c.closedAt && new Date(c.closedAt).toISOString().slice(0,19).replace(/[:T]/g,'-')) || 'turno'}.csv`;
  a.click(); URL.revokeObjectURL(url);
}
