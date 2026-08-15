/**
 * Camera Module for MINNAL-X
 * Handles webcam initialization, stream capture, browser compatibility, and detailed error mapping.
 */

export class Camera {
  /**
   * @param {HTMLVideoElement} videoElement The video element to display the stream.
   */
  constructor(videoElement) {
    if (!videoElement) {
      throw new Error('Camera: Video element is required.');
    }
    this.videoElement = videoElement;
    this.stream = null;
  }

  /**
   * Exposes the underlying HTMLVideoElement.
   * @returns {HTMLVideoElement}
   */
  getVideoElement() {
    return this.videoElement;
  }

  /**
   * Initializes the webcam stream.
   * @returns {Promise<HTMLVideoElement>} The active video element.
   */
  async start() {
    console.log('Camera: Requesting stream...');

    // 1. Check browser compatibility
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const errorMsg = 'Browser does not support MediaDevices API or getUserMedia.';
      console.error('Camera:', errorMsg);
      throw new Error(errorMsg);
    }

    try {
      // 2. Request video stream
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        },
        audio: false
      });

      this.videoElement.srcObject = this.stream;
      this.videoElement.play();

      return new Promise((resolve) => {
        this.videoElement.onloadedmetadata = () => {
          console.log(`Camera: Loaded stream successfully (${this.videoElement.videoWidth}x${this.videoElement.videoHeight})`);
          resolve(this.videoElement);
        };
      });
    } catch (error) {
      console.error('Camera: getUserMedia failed:', error);
      
      // 3. Map standard media exceptions
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        throw new Error('CAMERA_PERMISSION_DENIED');
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        throw new Error('CAMERA_NOT_FOUND');
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        throw new Error('CAMERA_IN_USE_OR_LOCKED');
      } else {
        throw new Error(`CAMERA_UNKNOWN_ERROR: ${error.message}`);
      }
    }
  }

  /**
   * Stops the active webcam stream.
   */
  stop() {
    if (this.stream) {
      console.log('Camera: Releasing media tracks...');
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
  }
}
