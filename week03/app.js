'use strict';

let model;
let modelLoading;
let cameraSession;
let frame;
let inputVersion = 0;
const start = document.getElementById('start');
const status = document.getElementById('status');
const labels = document.getElementById('label-container');
const fallback = document.getElementById('fallback');

async function loadModel() {
  if (!window.tf || !window.tmImage) throw new Error('실행 라이브러리를 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
  if (model) return model;
  if (!modelLoading) {
    const request = { expired: false };
    modelLoading = request;
    request.promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        request.expired = true;
        if (modelLoading === request) modelLoading = undefined;
        reject(new Error('모델 다운로드 시간이 초과되었습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.'));
      }, 20000);
      Promise.resolve().then(() => tmImage.load('./model/model.json', './model/metadata.json'))
        .then(loaded => {
          clearTimeout(timer);
          // A late download must not replace a newer model or leak its tensors.
          if (request.expired || modelLoading !== request) { loaded.dispose?.(); return; }
          model = loaded;
          resolve(loaded);
        })
        .catch(error => {
          clearTimeout(timer);
          if (request.expired) return;
          if (modelLoading === request) modelLoading = undefined;
          reject(error);
        });
    });
  }
  return modelLoading.promise;
}

async function showPrediction(source, isCurrent = () => true) {
  const predictions = await model.predict(source);
  if (!isCurrent()) return;
  labels.replaceChildren(...predictions.map(item => {
    const row = document.createElement('div');
    row.textContent = item.className + ': ' + (item.probability * 100).toFixed(1) + '%';
    return row;
  }));
}

function releaseCamera(camera) {
  // Webcam.stop() throws if setup() failed before creating a video.
  const video = camera?.webcam;
  if (!video) return;
  video.srcObject?.getTracks().forEach(track => track.stop());
  video.srcObject = null;
}

function stopCamera() {
  inputVersion++;
  const previous = cameraSession;
  cameraSession = undefined;
  clearTimeout(previous?.timer);
  cancelAnimationFrame(frame);
  previous?.removeTrackListeners?.();
  releaseCamera(previous?.camera);
  document.getElementById('webcam-container').replaceChildren();
  start.disabled = false;
  start.textContent = '카메라 시작';
  start.setAttribute('aria-pressed', 'false');
  start.removeAttribute('aria-busy');
}

function cameraEnded(session) {
  if (cameraSession !== session) return;
  stopCamera();
  labels.replaceChildren();
  status.textContent = '카메라 연결이 종료되었습니다. 카메라 권한과 연결 상태를 확인한 뒤 다시 시작해 주세요.';
}

async function loop(session) {
  if (cameraSession !== session) return;
  if (session.camera.webcam.srcObject?.getTracks().some(track => track.readyState === 'ended')) {
    cameraEnded(session);
    return;
  }
  try {
    session.camera.update();
    await showPrediction(session.camera.canvas, () => cameraSession === session);
    if (cameraSession === session) frame = requestAnimationFrame(() => loop(session));
  } catch (error) {
    if (cameraSession !== session) return;
    stopCamera();
    status.textContent = '분류 오류: ' + (error.message || error);
  }
}

start.addEventListener('click', async () => {
  if (cameraSession) { stopCamera(); status.textContent = '카메라를 종료했습니다.'; return; }
  stopCamera();
  fallback.hidden = false;
  document.getElementById('photo-preview').hidden = true;
  labels.replaceChildren();
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    status.textContent = '카메라는 HTTPS 주소에서 사용할 수 있습니다. 휴대폰에서는 이 주소를 Safari 또는 Chrome으로 직접 열어 주세요. 사진 테스트도 가능합니다.';
    return;
  }
  const session = {};
  cameraSession = session;
  start.textContent = '시작 취소';
  start.setAttribute('aria-busy', 'true');
  status.textContent = '모델을 불러오는 중…';
  session.timer = setTimeout(() => {
    if (cameraSession !== session) return;
    stopCamera();
    status.textContent = '시작 응답이 지연되고 있습니다. 브라우저의 카메라 권한을 확인한 뒤 다시 시도해 주세요. 카카오톡 등 앱 안에서 열었다면 Safari 또는 Chrome에서 직접 열어 주세요.';
  }, 30000);
  try {
    await loadModel();
    if (cameraSession !== session) return;
    status.textContent = '카메라 사용을 허용해 주세요. 기다리는 동안 시작 취소를 누를 수 있습니다.';
    session.camera = new tmImage.Webcam(224, 224, true);
    await session.camera.setup();
    if (cameraSession !== session) { releaseCamera(session.camera); return; }
    const tracks = session.camera.webcam.srcObject.getTracks();
    const onEnded = () => cameraEnded(session);
    tracks.forEach(track => track.addEventListener('ended', onEnded, { once: true }));
    session.removeTrackListeners = () => tracks.forEach(track => track.removeEventListener('ended', onEnded));
    // iOS needs inline playback even for the library's off-screen video.
    const video = session.camera.webcam;
    video.playsInline = true;
    video.muted = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('muted', '');
    status.textContent = '카메라 영상을 준비하는 중…';
    await session.camera.play();
    if (cameraSession !== session) { releaseCamera(session.camera); return; }
    clearTimeout(session.timer);
    document.getElementById('webcam-container').replaceChildren(session.camera.canvas);
    start.textContent = '카메라 종료';
    start.setAttribute('aria-pressed', 'true');
    start.removeAttribute('aria-busy');
    status.textContent = '';
    frame = requestAnimationFrame(() => loop(session));
  } catch (error) {
    releaseCamera(session.camera);
    if (cameraSession !== session) return;
    stopCamera();
    console.error('카메라 시작 실패:', error);
    status.textContent = model
      ? '카메라를 시작하지 못했습니다. 브라우저의 카메라 권한과 다른 앱의 카메라 사용 여부를 확인해 주세요. 휴대폰에서는 Safari 또는 Chrome으로 직접 열거나 아래 사진 테스트를 이용해 주세요.'
      : '모델 로딩 실패: ' + (error.message || error);
  }
});

document.getElementById('photo').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';
  stopCamera();
  const version = inputVersion;
  labels.replaceChildren();
  document.getElementById('photo-preview').hidden = true;
  status.textContent = '사진을 분석하는 중…';
  const objectURL = URL.createObjectURL(file);
  try {
    await loadModel();
    const image = new Image();
    image.src = objectURL;
    await image.decode();
    if (version !== inputVersion) return;
    const canvas = document.getElementById('photo-preview');
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    canvas.getContext('2d').drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 224, 224);
    canvas.hidden = false;
    await showPrediction(canvas, () => version === inputVersion);
    if (version === inputVersion) status.textContent = '';
  } catch (error) {
    if (version === inputVersion) status.textContent = '사진 분류 실패: ' + (error.message || error);
  } finally { URL.revokeObjectURL(objectURL); }
});

window.addEventListener('pagehide', stopCamera);
