/**
 * RemotePanel — tarjeta «Control remoto» del panel lateral.
 *
 * Muestra el código QR y el PIN para abrir el mando en el teléfono, los
 * teléfonos conectados (quién tiene el mando) y qué hacer si el puente no está.
 */

import qrcode from 'qrcode-generator';
import type { BridgeView } from '../remote/RemoteHost';

/** Lado del código QR en pantalla [px] */
const QR_SIZE = 148;
/** Margen blanco alrededor del código, en módulos (el estándar pide ≥ 2 para leerlo bien) */
const QR_QUIET = 2;

export class RemotePanel {
  private readonly root: HTMLElement;
  private view: BridgeView | null = null;
  private url = '';
  private onReclaim: () => void = () => {};

  constructor(container: HTMLElement) {
    this.root = container;
    container.innerHTML = `
      <details class="card remote-card" data-collapse="remote">
        <summary class="card-head">
          <h2 class="card-title"><span class="chevron" aria-hidden="true">▸</span> Control remoto</h2>
          <span class="remote-summary" data-out="summary"><span class="remote-dot"></span><span data-out="summary-text">…</span></span>
        </summary>
        <div class="remote-body">
          <div class="remote-pair" data-out="pair" hidden>
            <canvas class="remote-qr" data-out="qr" aria-label="Código QR para abrir el mando en el teléfono"></canvas>
            <div class="remote-pin">
              <span class="hud-label">PIN</span>
              <b data-out="pin">····</b>
              <span class="hint">Escanéalo con la cámara del teléfono, conectado a la misma red WiFi que este PC.</span>
            </div>
          </div>
          <div class="remote-link" data-out="link" hidden>
            <select data-input="remote-url" aria-label="Dirección del mando" hidden></select>
            <code class="mono" data-out="url"></code>
            <button type="button" class="btn btn-ghost btn-sm" data-action="remote-copy">Copiar enlace</button>
          </div>
          <ul class="remote-phones" data-out="phones"></ul>
          <p class="hint" data-out="hint"></p>
          <button type="button" class="btn btn-sm" data-action="remote-reclaim" hidden>Usar el control remoto en esta pestaña</button>
        </div>
      </details>
    `;
    const select = this.q<HTMLSelectElement>('[data-input="remote-url"]');
    select.addEventListener('change', () => this.setUrl(select.value));
    this.q('[data-action="remote-copy"]').addEventListener('click', () => {
      void navigator.clipboard?.writeText(this.url).then(() => {
        const btn = this.q('[data-action="remote-copy"]');
        btn.textContent = '✓ Copiado';
        setTimeout(() => { btn.textContent = 'Copiar enlace'; }, 1500);
      });
    });
    this.q('[data-action="remote-reclaim"]').addEventListener('click', () => this.onReclaim());
  }

  private q<T extends HTMLElement = HTMLElement>(selector: string): T {
    const el = this.root.querySelector<T>(selector);
    if (!el) throw new Error(`RemotePanel: no existe ${selector}`);
    return el;
  }

  setReclaimHandler(cb: () => void): void {
    this.onReclaim = cb;
  }

  update(v: BridgeView): void {
    const prev = this.view;
    this.view = v;
    const ready = v.status === 'online' && v.exposed && v.urls.length > 0;
    const summary = this.q('[data-out="summary"]');
    summary.dataset.state = ready ? (v.phones.length ? 'phones' : 'ready') : v.status === 'online' ? 'local' : v.status;

    const n = v.phones.length;
    this.q('[data-out="summary-text"]').textContent =
      v.status === 'off' ? 'no disponible'
        : v.status === 'connecting' ? 'conectando…'
          : v.status === 'replaced' ? 'en otra pestaña'
            : !ready ? 'solo este PC'
              : n === 0 ? `PIN ${v.pin}` : `${n} ${n === 1 ? 'teléfono' : 'teléfonos'}`;

    this.q('[data-out="pair"]').hidden = !ready;
    this.q('[data-out="link"]').hidden = !ready;
    this.q('[data-action="remote-reclaim"]').hidden = v.status !== 'replaced';
    this.q('[data-out="pin"]').textContent = v.pin || '····';

    // Direcciones: si el PC tiene varias redes, se elige cuál va en el QR
    const select = this.q<HTMLSelectElement>('[data-input="remote-url"]');
    if (ready && (prev?.urls.join() !== v.urls.join() || prev?.pin !== v.pin)) {
      select.innerHTML = '';
      for (const u of v.urls) {
        const opt = document.createElement('option');
        opt.value = u;
        opt.textContent = new URL(u).host;
        select.append(opt);
      }
      select.hidden = v.urls.length < 2;
      this.setUrl(v.urls.includes(this.url) ? this.url : v.urls[0]);
      if (v.urls.includes(this.url)) select.value = this.url;
    }

    // Teléfonos conectados
    const list = this.q('[data-out="phones"]');
    list.innerHTML = '';
    list.hidden = v.status !== 'online';
    if (v.status === 'online' && n === 0) {
      const li = document.createElement('li');
      li.className = 'remote-phone empty';
      li.textContent = 'Ningún teléfono conectado';
      list.append(li);
    }
    for (const p of v.phones) {
      const li = document.createElement('li');
      li.className = `remote-phone${p.controller ? ' controller' : ''}`;
      const name = document.createElement('span');
      name.textContent = `📱 ${p.name}`;
      const role = document.createElement('span');
      role.className = 'remote-role';
      role.textContent = p.controller ? 'tiene el mando' : 'solo ver';
      li.append(name, role);
      list.append(li);
    }

    this.q('[data-out="hint"]').innerHTML =
      v.status === 'off'
        ? 'El puente del control remoto no está activo. En la carpeta <code>Simulador</code> abre el simulador con <code>npm run remoto</code>.'
        : v.status === 'replaced'
          ? 'Otra pestaña de este PC está atendiendo al teléfono. Solo una puede hacerlo a la vez.'
          : v.status === 'online' && !v.exposed
            ? 'El servidor solo escucha en este PC. Ciérralo y ábrelo con <code>npm run remoto</code> para que el teléfono pueda entrar.'
            : v.status === 'online' && v.urls.length === 0
              ? 'Este PC no está conectado a ninguna red. Conéctalo al mismo WiFi que el teléfono.'
              : ready
                ? 'El teléfono manda órdenes y esta página las aplica: los dos controles quedan siempre sincronizados. Si el teléfono se desconecta, el lazo sigue con el último setpoint.'
                : '';
  }

  private setUrl(url: string): void {
    this.url = url;
    this.q('[data-out="url"]').textContent = url.replace(/^https?:\/\//, '').replace(/\?pin=\d+$/, '');
    this.drawQr(url);
  }

  private drawQr(text: string): void {
    const canvas = this.q<HTMLCanvasElement>('[data-out="qr"]');
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const cell = Math.max(2, Math.floor(QR_SIZE / (n + 2 * QR_QUIET)));
    const side = cell * (n + 2 * QR_QUIET);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = side * dpr;
    canvas.height = side * dpr;
    canvas.style.width = `${side}px`;
    canvas.style.height = `${side}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#e8eaf0';
    ctx.fillRect(0, 0, side, side);
    ctx.fillStyle = '#0f1117';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect((c + QR_QUIET) * cell, (r + QR_QUIET) * cell, cell, cell);
      }
    }
  }
}
