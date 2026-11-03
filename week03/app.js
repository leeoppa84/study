'use strict';

let model;
let webcam;
let running = false;
let frame;
const start = document.getElementById('start');
const status = document.getElementById('status');
const labels = document.getElementById('label-container');

async function loadModel() {
  if (!window.tf || !window.tmImage) throw new Error('실행 라이브러리를 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
  if (!model) model = await tmImage.load('./model/model.json', './model/metadata.json');
  return model;
}

async function showPrediction(source) {
  const predictions = await model.predict(source);
  labels.replaceChildren(...predictions.map(item => {
    const row = document.createElement('div');
    row.textContent = `${item.className}: ${(item.probability * 100).toFixed(1)}%`;
    return row;
  }));
  return predictions;
}

function stopCamera() {
  running = false;
  cancelAnimationFrame(frame);
  if (webcam) webcam.stop();
  webcam = undefined;
  document.getElementById('webcam-container').replaceChildren();
  start.textContent = '카메라 시작';
}

async function loop() {
  if (!running) return;
  try {
    webcam.update();
    await showPrediction(webcam.canvas);
    if (running) frame = requestAnimationFrame(loop);
  } catch (error) {
    stopCamera();
    status.textContent = `분류 오류: ${error.message}`;
  }
}

start.addEventListener('click', async () => {
  if (running) { stopCamera(); status.textContent = ''; return; }
  start.disabled = true;
  status.textContent = '모델을 불러오는 중…';
  try {
    await loadModel();
    document.getElementById('fallback').hidden = false;
    status.textContent = '카메라 사용을 허용해 주세요.';
    webcam = new tmImage.Webcam(224, 224, true);
    await webcam.setup();
    await webcam.play();
    document.getElementById('webcam-container').replaceChildren(webcam.canvas);
    running = true;
    start.textContent = '카메라 종료';
    status.textContent = '';
    frame = requestAnimationFrame(loop);
  } catch (error) {
    stopCamera();
    status.textContent = model
      ? '카메라를 사용할 수 없습니다. 카메라 권한과 연결 상태를 확인하거나 아래에서 사진을 선택해 주세요.'
      : `모델 로딩 실패: ${error.message}`;
  } finally { start.disabled = false; }
});

document.getElementById('photo').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  stopCamera();
  const objectURL = URL.createObjectURL(file);
  try {
    await loadModel();
    const image = new Image();
    image.src = objectURL;
    await image.decode();
    const canvas = document.getElementById('photo-preview');
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    canvas.getContext('2d').drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 224, 224);
    canvas.hidden = false;
    await showPrediction(canvas);
    status.textContent = '';
  } catch (error) { status.textContent = `사진 분류 실패: ${error.message}`; }
  finally { URL.revokeObjectURL(objectURL); }
});

window.addEventListener('pagehide', stopCamera);
