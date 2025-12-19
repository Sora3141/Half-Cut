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

// 汎用ボタンイベント：Chrome/Safari両対応
function addSmartEventListener(el, callback) {
    let touched = false;
    el.addEventListener('touchstart', (e) => {
        touched = true;
        e.preventDefault();
        callback(e);
    }, { passive: false });
    el.addEventListener('click', (e) => {
        if (!touched) callback(e);
        touched = false;
    });
}

function initGame() {
    holePolygon = [];
    let vertices, minR, maxR;
    if (currentDifficulty === 1) { vertices = 6; minR = 0.7; maxR = 0.9; }
    else if (currentDifficulty === 2) { vertices = 10; minR = 0.3; maxR = 1.2; }
    else {
        vertices = 12; minR = 0.4; maxR = 1.1;
        holePolygon = generateRandomPolygon(300 + (Math.random()-0.5)*40, 200 + (Math.random()-0.5)*40, 40, 6, 0.5, 0.8);
    }
    polygon = generateRandomPolygon(300, 200, 120, vertices, minR, maxR);
    resetLineState();
    appContainer.classList.remove('shake-heavy', 'shake-sharp');
    judgmentOverlay.classList.remove('pop-animation');
    judgmentOverlay.style.opacity = "0";
    resultDisplay.innerHTML = ">> AWAITING INPUT...";
    draw();
}

function resetLineState() { startPoint = null; endPoint = null; isDrawing = false; isEvaluated = false; }

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

function isPointInPolygon(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        if (((poly[i].y > pt.y) !== (poly[j].y > pt.y)) && (pt.x < (poly[j].x - poly[i].x) * (pt.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x)) inside = !inside;
    }
    return inside;
}

function calculateSplit() {
    if (!startPoint || !endPoint) return;
    const dist = Math.sqrt(Math.pow(endPoint.x - startPoint.x, 2) + Math.pow(endPoint.y - startPoint.y, 2));
    if (dist < 20) { resetLineState(); return; }
    if (isInsideTarget(startPoint) || isInsideTarget(endPoint)) {
        resultDisplay.innerHTML = "!! ERROR: INCOMPLETE !!";
        return;
    }
    let countCyan = 0; let totalSamples = 0;
    for (let x = 0; x < canvas.width; x += 5) {
        for (let y = 0; y < canvas.height; y += 5) {
            if (isInsideTarget({x, y})) {
                totalSamples++;
                const val = (endPoint.y - startPoint.y) * (x - startPoint.x) - (endPoint.x - startPoint.x) * (y - startPoint.y);
                if (val > 0) countCyan++;
            }
        }
    }
    if (totalSamples === 0 || countCyan === 0 || countCyan === totalSamples) {
        resultDisplay.innerHTML = "!! ERROR: NO TARGET !!";
        return;
    }
    isEvaluated = true;
    const ratioCyan = (countCyan / totalSamples) * 100;
    const diff = Math.abs(50 - ratioCyan);
    let rank = ""; let shake = "";
    if (diff === 0) { rank = "PERFECT"; shake = "shake-sharp"; }
    else if (diff < 1) { rank = "CRITICAL"; shake = "shake-sharp"; }
    else if (diff < 5) { rank = "SECURED"; }
    else { rank = "OUT RANGE"; shake = "shake-heavy"; }
    if (shake) appContainer.classList.add(shake);
    judgmentOverlay.innerText = rank;
    judgmentOverlay.classList.add('pop-animation');
    resultDisplay.innerHTML = `<div style="font-size:1.8rem;">${ratioCyan.toFixed(1)}% : ${(100-ratioCyan).toFixed(1)}%</div><div>${rank}</div>`;
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
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
        ctx.fillStyle = "rgba(255, 0, 255, 0.25)";
        ctx.fill(mainPath, "evenodd");
        ctx.save(); ctx.clip(mainPath, "evenodd");
        const angle = Math.atan2(endPoint.y - startPoint.y, endPoint.x - startPoint.x);
        ctx.translate(startPoint.x, startPoint.y); ctx.rotate(angle);
        ctx.fillStyle = "rgba(0, 242, 255, 0.35)";
        ctx.fillRect(-3000, -3000, 6000, 3000); ctx.restore();
    } else {
        ctx.fillStyle = "rgba(0, 242, 255, 0.12)";
        ctx.fill(mainPath, "evenodd");
    }
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
    const clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
    const clientY = (e.touches && e.touches.length > 0) ? e.touches[0].clientY : e.clientY;
    return { x: (clientX - rect.left) * (canvas.width / rect.width), y: (clientY - rect.top) * (canvas.height / rect.height) };
}

function handleStart(e) {
    if(e.target !== canvas) return;
    if(e.cancelable) e.preventDefault();
    resetLineState();
    judgmentOverlay.classList.remove('pop-animation');
    judgmentOverlay.style.opacity = "0";
    appContainer.classList.remove('shake-heavy', 'shake-sharp');
    startPoint = getCanvasPoint(e); endPoint = startPoint; isDrawing = true; draw();
}
function handleMove(e) { if(!isDrawing) return; if(e.cancelable) e.preventDefault(); endPoint = getCanvasPoint(e); draw(); }
function handleEnd() { if(!isDrawing) return; isDrawing = false; calculateSplit(); draw(); }

canvas.addEventListener('mousedown', handleStart);
window.addEventListener('mousemove', handleMove);
window.addEventListener('mouseup', handleEnd);
canvas.addEventListener('touchstart', handleStart, {passive: false});
window.addEventListener('touchmove', handleMove, {passive: false});
window.addEventListener('touchend', handleEnd, {passive: false});

// 難易度ボタン設定
document.querySelectorAll('.diff-btn').forEach(btn => {
    addSmartEventListener(btn, () => {
        currentDifficulty = parseInt(btn.getAttribute('data-level'));
        document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        initGame();
    });
});

// NEXTボタン・HELPボタン
addSmartEventListener(document.getElementById('resetBtn'), initGame);
const helpModal = document.querySelector('.modal-overlay');
addSmartEventListener(document.getElementById('helpBtn'), () => helpModal.style.display = 'flex');
addSmartEventListener(document.getElementById('closeHelp'), () => helpModal.style.display = 'none');
addSmartEventListener(helpModal, () => helpModal.style.display = 'none');

document.fonts.ready.then(() => initGame());