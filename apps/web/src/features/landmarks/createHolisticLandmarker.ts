import {
  FilesetResolver,
  HolisticLandmarker,
} from '@mediapipe/tasks-vision'

const WASM_ROOT =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task'

export async function createHolisticLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(WASM_ROOT, true)

  return HolisticLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minHandLandmarksConfidence: 0.5,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    outputFaceBlendshapes: false,
    outputPoseSegmentationMasks: false,
  })
}
