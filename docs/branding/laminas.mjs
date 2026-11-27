// Exporta cada lámina de laminas.html a PNG (1400 × 900) y la miniatura 808 × 632.
// Uso: node docs/branding/laminas.mjs (usa el Playwright de docs/capturas)
import { chromium } from '../capturas/node_modules/playwright/index.mjs';
const aqui = new URL('.', import.meta.url).pathname;
const nombres = ['caratula', 'brief-y-desafio', 'concepto', 'logotipo-positivo-negativo', 'construccion', 'area-de-seguridad', 'versiones', 'usos-incorrectos', 'paleta', 'tipografia', 'recursos-graficos', 'aplicacion-web', 'aplicacion-celular', 'piezas', 'cierre'];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
await page.goto('file://' + aqui + 'laminas.html', { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
for (let i = 0; i < nombres.length; i++) {
  await page.locator(`#s${String(i + 1).padStart(2, '0')}`).screenshot({ path: `${aqui}${String(i + 1).padStart(2, '0')}-${nombres[i]}.png` });
}
const mini = await browser.newPage({ viewport: { width: 808, height: 632 } });
await mini.goto('file://' + aqui + 'laminas.html', { waitUntil: 'networkidle' });
await mini.evaluate(() => document.fonts.ready);
await mini.evaluate(() => { const s = document.getElementById('s01'); s.style.width = '808px'; s.style.height = '632px'; s.style.padding = '60px'; s.querySelector('.wm').style.setProperty('--w', '78px'); s.querySelector('.iso').style.setProperty('--s', '120px'); });
await mini.locator('#s01').screenshot({ path: aqui + 'miniatura-808x632.png' });
await browser.close();
console.log('ok');
