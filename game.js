const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const resultDisplay = document.getElementById('result');
const appContainer = document.getElementById('appContainer');
const judgmentOverlay = document.getElementById('judgmentOverlay');

let polygon = [];
let isDrawing = false;
let isEvaluated = false;
let startPoint = null;
let endPoint = null;

function initGame() {
    const vertices = Math.floor(Math.random() * 4) + 6;
    polygon = generateRandomPolygon(300, 200, 120, vertices);
    resetLineState();
    appContainer.classList.remove('shake-heavy', 'shake-sharp');
    judgmentOverlay.classList.remove('pop-animation');
    judgmentOverlay.style.opacity = "0";
    resultDisplay.innerHTML = ">> AWAITING OPERATOR INPUT...";
    resultDisplay.style.color = "#00f2ff";
    draw();
}

function resetLineState() {
    startPoint = null; endPoint = null; isDrawing = false; isEvaluated = false;
}

function generateRandomPolygon(cx, cy, avgRadius, numPoints) {
    const points = [];
    for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * Math.PI * 2;
        const r = avgRadius * (0.6 + Math.random() * 0.7);
        points.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
    }
    return points;
}

function calculateSplit() {
    if (!startPoint || !endPoint) return;
    const dist = Math.sqrt(Math.pow(endPoint.x - startPoint.x, 2) + Math.pow(endPoint.y - startPoint.y, 2));
    if (dist < 15) { resetLineState(); return; }

    if (isPointInPolygon(startPoint, polygon) || isPointInPolygon(endPoint, polygon)) {
        resultDisplay.innerHTML = "!! ERROR: INCOMPLETE SLIT !!";
        resultDisplay.style.color = "#ff00ff";
        return;
    }

    let countCyan = 0; let totalSamples = 0;
    // スキャン範囲を広めに設定 (0〜600)
    for (let x = 0; x < canvas.width; x += 4) {
        for (let y = 0; y < canvas.height; y += 4) {
            if (isPointInPolygon({x, y}, polygon)) {
                totalSamples++;
                const val = (endPoint.y - startPoint.y) * (x - startPoint.x) - (endPoint.x - startPoint.x) * (y - startPoint.y);
                if (val > 0) countCyan++;
            }
        }
    }

    if (totalSamples === 0 || countCyan === 0 || countCyan === totalSamples) {
        resultDisplay.innerHTML = "!! ERROR: TARGET NOT ACQUIRED !!";
        resultDisplay.style.color = "#ff00ff";
        isEvaluated = false;
        return;
    }

    isEvaluated = true;
    const ratioCyan = (countCyan / totalSamples) * 100;
    const ratioMagenta = 100 - ratioCyan;
    const diff = Math.abs(50 - ratioCyan);
    
    let rankTitle = "";
    let rankColor = "#00f2ff";
    let shakeClass = "";

    appContainer.classList.remove('shake-heavy', 'shake-sharp');
    judgmentOverlay.classList.remove('pop-animation');
    void appContainer.offsetWidth; 

    if (diff === 0) {
        rankTitle = "PERFECT";
        rankColor = "#ffffff";
        shakeClass = "shake-sharp";
    } else if (diff < 1.0) {
        rankTitle = "CRITICAL";
        rankColor = "#00f2ff";
        shakeClass = "shake-sharp";
    } else if (diff < 5.0) {
        rankTitle = "SECURED";
        rankColor = "#ffffff";
    } else {
        rankTitle = "OUT OF RANGE";
        rankColor = "#ff00ff";
        shakeClass = "shake-heavy";
    }

    if (shakeClass) appContainer.classList.add(shakeClass);
    judgmentOverlay.innerText = rankTitle;
    judgmentOverlay.style.color = rankColor;
    judgmentOverlay.style.textShadow = `0 0 20px ${rankColor}`;
    judgmentOverlay.classList.add('pop-animation');

    // 下部の数値をシアンとマゼンタに色分け
    resultDisplay.innerHTML = `
        <div style="display: flex; justify-content: center; gap: 20px; font-size: 1.8rem; font-family: 'Orbitron'; line-height: 1;">
            <span style="color: var(--accent-cyan); text-shadow: 0 0 10px var(--accent-cyan);">${ratioCyan.toFixed(1)}%</span>
            <span style="color: #fff; opacity: 0.2;">:</span>
            <span style="color: var(--accent-magenta); text-shadow: 0 0 10px var(--accent-magenta);">${ratioMagenta.toFixed(1)}%</span>
        </div>
        <div style="color: ${rankColor}; font-size: 0.8rem; margin-top: 10px; letter-spacing: 2px;">>> ANALYSIS_COMPLETE: ${rankTitle}</div>
    `;
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(0, 242, 255, 0.05)";
    for(let x=0; x<canvas.width; x+=20) for(let y=0; y<canvas.height; y+=20) ctx.fillRect(x, y, 1, 1);

    const path = new Path2D();
    path.moveTo(polygon[0].x, polygon[0].y);
    polygon.forEach(p => path.lineTo(p.x, p.y));
    path.closePath();

    if (isEvaluated && startPoint && endPoint) {
        // マゼンタ側（背面）
        ctx.fillStyle = "rgba(255, 0, 255, 0.2)"; 
        ctx.fill(path);
        
        ctx.save(); 
        ctx.clip(path);
        const angle = Math.atan2(endPoint.y - startPoint.y, endPoint.x - startPoint.x);
        ctx.translate(startPoint.x, startPoint.y); ctx.rotate(angle);
        
        // シアン側（前面）
        ctx.fillStyle = "rgba(0, 242, 255, 0.3)"; 
        ctx.fillRect(-3000, -3000, 6000, 3000); 
        ctx.restore();
    } else {
        ctx.fillStyle = "rgba(0, 242, 255, 0.08)"; ctx.fill(path);
    }

    ctx.strokeStyle = "#00f2ff"; 
    ctx.lineWidth = 2; 
    ctx.stroke(path);

    if (startPoint && endPoint) {
        ctx.beginPath(); ctx.moveTo(startPoint.x, startPoint.y); ctx.lineTo(endPoint.x, endPoint.y);
        ctx.strokeStyle = isDrawing ? "#ff00ff" : "#fff"; ctx.lineWidth = 2;
        if (isDrawing) ctx.setLineDash([10, 5]);
        ctx.stroke(); ctx.setLineDash([]);
    }
}

function getCanvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
    const clientY = (e.touches && e.touches.length > 0) ? e.touches[0].clientY : e.clientY;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}

function isPointInPolygon(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        if (((poly[i].y > pt.y) !== (poly[j].y > pt.y)) && (pt.x < (poly[j].x - poly[i].x) * (pt.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x)) inside = !inside;
    }
    return inside;
}

function toggleHelp() {
    const modal = document.getElementById('helpModal');
    modal.style.display = (modal.style.display === 'flex') ? 'none' : 'flex';
}

function handleStart(e) { 
    if(e.cancelable) e.preventDefault(); 
    resetLineState(); 
    judgmentOverlay.classList.remove('pop-animation');
    judgmentOverlay.style.opacity = "0";
    appContainer.classList.remove('shake-heavy', 'shake-sharp');
    startPoint = getCanvasPoint(e); 
    endPoint = startPoint; 
    isDrawing = true; 
    draw(); 
}

function handleMove(e) { if(!isDrawing) return; if(e.cancelable) e.preventDefault(); endPoint = getCanvasPoint(e); draw(); }
function handleEnd() { if(!isDrawing) return; isDrawing = false; calculateSplit(); draw(); }

canvas.addEventListener('mousedown', handleStart);
window.addEventListener('mousemove', handleMove);
window.addEventListener('mouseup', handleEnd);
canvas.addEventListener('touchstart', handleStart, {passive: false});
window.addEventListener('touchmove', handleMove, {passive: false});
window.addEventListener('touchend', handleEnd);

document.fonts.ready.then(() => initGame());