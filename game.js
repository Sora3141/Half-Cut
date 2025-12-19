const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const resultDisplay = document.getElementById('result');
const appContainer = document.getElementById('appContainer');
const judgmentOverlay = document.getElementById('judgmentOverlay');

let polygon = [];
let holePolygon = [];
let isDrawing = false;
let isEvaluated = false;
let startPoint = null;
let endPoint = null;
let currentDifficulty = 1;

function setDifficulty(lv) {
    currentDifficulty = lv;
    document.querySelectorAll('.diff-btn').forEach((btn, i) => {
        btn.classList.toggle('active', i + 1 === lv);
    });
    initGame();
}

function initGame() {
    holePolygon = [];
    let vertices, minR, maxR;

    if (currentDifficulty === 1) {
        vertices = Math.floor(Math.random() * 3) + 5;
        minR = 0.7; maxR = 0.9;
    } else if (currentDifficulty === 2) {
        vertices = Math.floor(Math.random() * 5) + 8;
        minR = 0.3; maxR = 1.2;
    } else {
        vertices = Math.floor(Math.random() * 6) + 10;
        minR = 0.4; maxR = 1.1;
        const hx = 300 + (Math.random() - 0.5) * 40;
        const hy = 200 + (Math.random() - 0.5) * 40;
        holePolygon = generateRandomPolygon(hx, hy, 40, 6, 0.5, 0.8);
    }

    polygon = generateRandomPolygon(300, 200, 120, vertices, minR, maxR);
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

function generateRandomPolygon(cx, cy, avgRadius, numPoints, minR, maxR) {
    const points = [];
    for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * Math.PI * 2;
        const r = avgRadius * (minR + Math.random() * (maxR - minR));
        points.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
    }
    return points;
}

function isInsideTarget(pt) {
    const inMain = isPointInPolygon(pt, polygon);
    const inHole = holePolygon.length > 0 ? isPointInPolygon(pt, holePolygon) : false;
    return inMain && !inHole;
}

function calculateSplit() {
    if (!startPoint || !endPoint) return;
    const dist = Math.sqrt(Math.pow(endPoint.x - startPoint.x, 2) + Math.pow(endPoint.y - startPoint.y, 2));
    if (dist < 20) { resetLineState(); return; }

    if (isInsideTarget(startPoint) || isInsideTarget(endPoint)) {
        resultDisplay.innerHTML = "!! ERROR: INCOMPLETE SLIT !!";
        resultDisplay.style.color = "#ff00ff";
        return;
    }

    let countCyan = 0; let totalSamples = 0;
    for (let x = 0; x < canvas.width; x += 4) {
        for (let y = 0; y < canvas.height; y += 4) {
            if (isInsideTarget({x, y})) {
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
    
    let rankTitle = ""; let rankColor = "#00f2ff"; let shakeClass = "";

    appContainer.classList.remove('shake-heavy', 'shake-sharp');
    judgmentOverlay.classList.remove('pop-animation');
    void appContainer.offsetWidth; 

    if (diff === 0) { rankTitle = "PERFECT"; rankColor = "#fff"; shakeClass = "shake-sharp"; }
    else if (diff < 1.0) { rankTitle = "CRITICAL"; rankColor = "#00f2ff"; shakeClass = "shake-sharp"; }
    else if (diff < 5.0) { rankTitle = "SECURED"; rankColor = "#fff"; }
    else { rankTitle = "OUT OF RANGE"; rankColor = "#ff00ff"; shakeClass = "shake-heavy"; }

    if (shakeClass) appContainer.classList.add(shakeClass);
    judgmentOverlay.innerText = rankTitle;
    judgmentOverlay.style.color = rankColor;
    judgmentOverlay.style.textShadow = `0 0 20px ${rankColor}`;
    judgmentOverlay.classList.add('pop-animation');

    resultDisplay.innerHTML = `
        <div style="display:flex; justify-content:center; gap:20px; font-size:1.8rem; font-family:'Orbitron'; line-height: 1;">
            <span style="color:#00f2ff;">${ratioCyan.toFixed(1)}%</span>
            <span style="color:#fff; opacity:0.2;">:</span>
            <span style="color:#ff00ff;">${ratioMagenta.toFixed(1)}%</span>
        </div>
        <div style="color:${rankColor}; font-size:0.8rem; margin-top:10px; letter-spacing:2px;">>> ANALYSIS_COMPLETE: ${rankTitle}</div>
    `;
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 背景グリッド
    ctx.fillStyle = "rgba(0, 242, 255, 0.05)";
    for(let x=0; x<canvas.width; x+=20) for(let y=0; y<canvas.height; y+=20) ctx.fillRect(x, y, 1, 1);

    const mainPath = new Path2D();
    mainPath.moveTo(polygon[0].x, polygon[0].y);
    polygon.forEach(p => mainPath.lineTo(p.x, p.y));
    mainPath.closePath();
    if (holePolygon.length > 0) {
        mainPath.moveTo(holePolygon[0].x, holePolygon[0].y);
        holePolygon.forEach(p => mainPath.lineTo(p.x, p.y));
        mainPath.closePath();
    }

    if (isEvaluated && startPoint && endPoint) {
        // 判定後の塗り分け
        ctx.fillStyle = "rgba(255, 0, 255, 0.25)";
        ctx.fill(mainPath, "evenodd");
        ctx.save(); ctx.clip(mainPath, "evenodd");
        const angle = Math.atan2(endPoint.y - startPoint.y, endPoint.x - startPoint.x);
        ctx.translate(startPoint.x, startPoint.y); ctx.rotate(angle);
        ctx.fillStyle = "rgba(0, 242, 255, 0.35)";
        ctx.fillRect(-3000, -3000, 6000, 3000); ctx.restore();
    } else {
        // カット前の図形実体化（ここを少し明るくして穴と区別）
        ctx.fillStyle = "rgba(0, 242, 255, 0.12)";
        ctx.fill(mainPath, "evenodd");
    }

    // 外枠
    ctx.strokeStyle = "rgba(0, 242, 255, 0.8)"; 
    ctx.lineWidth = 2; ctx.stroke(mainPath);

    if (startPoint && endPoint) {
        ctx.beginPath(); ctx.moveTo(startPoint.x, startPoint.y); ctx.lineTo(endPoint.x, endPoint.y);
        ctx.strokeStyle = isDrawing ? "#ff00ff" : "#fff"; ctx.lineWidth = 2;
        if (isDrawing) ctx.setLineDash([10, 5]);
        ctx.stroke(); ctx.setLineDash([]);
    }
}

function getCanvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
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
    if(e.cancelable) e.preventDefault(); resetLineState(); 
    judgmentOverlay.classList.remove('pop-animation'); judgmentOverlay.style.opacity = "0";
    appContainer.classList.remove('shake-heavy', 'shake-sharp');
    startPoint = getCanvasPoint(e); endPoint = startPoint; isDrawing = true; draw(); 
}
function handleMove(e) { if(!isDrawing) return; if(e.cancelable) e.preventDefault(); endPoint = getCanvasPoint(e); draw(); }
function handleEnd() { if(!isDrawing) return; isDrawing = false; calculateSplit(); draw(); }

canvas.addEventListener('mousedown', handleStart);
canvas.addEventListener('mousemove', handleMove);
window.addEventListener('mouseup', handleEnd);
canvas.addEventListener('touchstart', handleStart, {passive: false});
canvas.addEventListener('touchmove', handleMove, {passive: false});
canvas.addEventListener('touchend', handleEnd);

document.fonts.ready.then(() => initGame());