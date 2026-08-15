import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

/**
 * Hand Tracking Module for MINNAL-X
 * Handles MediaPipe Hand Landmarker initialization and detection.
 */
export class HandTracking {
  constructor() {
    this.handLandmarker = null;
    this.isLoading = false;
  }

  /**
   * Initializes FilesetResolver and HandLandmarker.
   */
  async init() {
    if (this.handLandmarker) return;
    
    this.isLoading = true;
    console.log('HandTracking: Initializing FilesetResolver...');
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
      );
      
      console.log('HandTracking: Creating HandLandmarker...');
      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/hand_landmarker.task',
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numHands: 1
      });
      console.log('HandTracking: MediaPipe HandLandmarker initialized successfully.');
    } catch (error) {
      console.error('HandTracking: Error initializing MediaPipe HandLandmarker:', error);
      this.handLandmarker = null;
      throw error;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Detects hands in the provided video frame.
   * @param {HTMLVideoElement} videoElement 
   * @param {number} timestamp The timestamp of the video frame in ms.
   * @returns {Object} Detected landmarks.
   */
  detect(videoElement, timestamp) {
    if (!this.handLandmarker) {
      return null;
    }
    
    try {
      return this.handLandmarker.detectForVideo(videoElement, timestamp);
    } catch (error) {
      console.error('HandTracking: Error during detection:', error);
      return null;
    }
  }
}
