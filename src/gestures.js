/**
 * Gestures Module for MINNAL-X
 * Recognizes hand gestures (OPEN_PALM, FIST, POINT, TWO_FINGER) using geometric landmark ratios,
 * and applies ring-buffer temporal smoothing and stable-frame filters to determine transitions.
 */

export const GESTURES = {
  OPEN_PALM: 'OPEN_PALM',
  FIST: 'FIST',
  POINT: 'POINT',
  TWO_FINGER: 'TWO_FINGER',
  UNKNOWN: 'UNKNOWN'
};

// Euclidean distance in 3D
function calculateDistance(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y, p1.z - p2.z);
}

// Clamps value between min and max
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

export class GestureAnalyzer {
  /**
   * @param {number} historyLength The size of the temporal smoothing window (in frames).
   * @param {number} minStableFrames The minimum occurrences in history required to switch active gesture.
   */
  constructor(historyLength = 12, minStableFrames = 7) {
    this.historyLength = historyLength;
    this.minStableFrames = minStableFrames;
    
    this.gestureHistory = [];
    this.confidenceHistory = [];
    
    // Position history for horizontal swipe detection
    this.positionHistory = [];
    this.lastSwipe = null;
    this.swipeCooldown = 500;
    this.lastSwipeTime = 0;
    
    // Public state variables
    this.currentGesture = GESTURES.UNKNOWN;
    this.gestureJustChanged = false;
  }

  /**
   * Analyzes landmarks to evaluate stable transitions and update public properties.
   * @param {Array} landmarks 21 MediaPipe hand landmarks.
   * @returns {Object} { gesture, confidence }
   */
  analyze(landmarks) {
    let rawGesture = GESTURES.UNKNOWN;
    let rawConfidence = 0;

    // 1. Perform classification if landmarks are present, otherwise push UNKNOWN
    if (landmarks && landmarks.length >= 21) {
      const classification = this.classify(landmarks);
      rawGesture = classification.rawGesture;
      rawConfidence = classification.rawConfidence;
    }

    // 2. Add to history ring buffer
    this.gestureHistory.push(rawGesture);
    this.confidenceHistory.push(rawConfidence);

    if (this.gestureHistory.length > this.historyLength) {
      this.gestureHistory.shift();
      this.confidenceHistory.shift();
    }

    // 3. Find majority gesture in the temporal history buffer
    const counts = {};
    let candidateGesture = GESTURES.UNKNOWN;
    let candidateCount = 0;

    for (const g of this.gestureHistory) {
      counts[g] = (counts[g] || 0) + 1;
      if (counts[g] > candidateCount) {
        candidateCount = counts[g];
        candidateGesture = g;
      }
    }

    // 4. Evaluate stable-frame transition filter
    if (candidateCount >= this.minStableFrames) {
      if (candidateGesture !== this.currentGesture) {
        console.log(`Gesture Transition Detected: ${this.currentGesture} -> ${candidateGesture}`);
        this.currentGesture = candidateGesture;
        this.gestureJustChanged = true;
      } else {
        this.gestureJustChanged = false;
      }
    } else {
      // Retain previous state to suppress small fluctuations and brief tracking dropouts
      this.gestureJustChanged = false;
    }

    // 5. Average the confidence score over frames matching the current confirmed stable gesture
    let matchingConfidenceSum = 0;
    let matchingCount = 0;
    for (let i = 0; i < this.gestureHistory.length; i++) {
      if (this.gestureHistory[i] === this.currentGesture) {
        matchingConfidenceSum += this.confidenceHistory[i];
        matchingCount++;
      }
    }

    const smoothedConfidence = matchingCount > 0 
      ? Math.round(matchingConfidenceSum / matchingCount)
      : (this.currentGesture === GESTURES.UNKNOWN ? 0 : 50);

    return { gesture: this.currentGesture, confidence: smoothedConfidence };
  }

  /**
   * Performs geometric classification on a single frame.
   * Uses both relative MCP distance and Wrist-PIP comparative extension.
   * @private
   */
  classify(landmarks) {
    // Reference palm size: Wrist (0) to Middle MCP joint (9)
    const palmSize = calculateDistance(landmarks[0], landmarks[9]);
    if (palmSize === 0) {
      return { rawGesture: GESTURES.UNKNOWN, rawConfidence: 0 };
    }

    // Helper for analyzing each finger's extension state
    const analyzeFinger = (tipIdx, pipIdx, mcpIdx) => {
      const tip = landmarks[tipIdx];
      const pip = landmarks[pipIdx];
      const mcp = landmarks[mcpIdx];
      const wrist = landmarks[0];

      const tipToMcp = calculateDistance(tip, mcp) / palmSize;
      const tipToWrist = calculateDistance(tip, wrist);
      const pipToWrist = calculateDistance(pip, wrist);

      // Extended: tip is farther from wrist than PIP and distance from MCP is healthy
      const isExtended = (tipToMcp > 0.46 && tipToWrist > pipToWrist * 1.02) || (tipToMcp > 0.58);
      const isFolded = (tipToMcp < 0.48) || (tipToWrist < pipToWrist * 1.08 && tipToMcp < 0.52);

      return { tipToMcp, tipToWrist, pipToWrist, isExtended, isFolded };
    };

    const index = analyzeFinger(8, 6, 5);
    const middle = analyzeFinger(12, 10, 9);
    const ring = analyzeFinger(16, 14, 13);
    const pinky = analyzeFinger(20, 18, 17);

    // 1. POINT: Index extended while Middle, Ring, Pinky are folded
    // Index extension must be clearly distinct from Middle
    const isPointing = index.isExtended && 
                       !middle.isExtended && 
                       !ring.isExtended && 
                       (index.tipToMcp > middle.tipToMcp + 0.10 || index.tipToWrist > middle.tipToWrist * 1.08);

    if (isPointing) {
      const extScore = clamp((index.tipToMcp - 0.40) / 0.30, 0.6, 1.0);
      const diffScore = clamp((index.tipToMcp - middle.tipToMcp) / 0.20, 0.6, 1.0);
      const conf = Math.round(((extScore + diffScore) / 2) * 100);
      return { rawGesture: GESTURES.POINT, rawConfidence: Math.min(99, Math.max(75, conf)) };
    }

    // 2. TWO_FINGER (Peace / V): Index & Middle extended, Ring & Pinky folded
    const isTwoFinger = index.isExtended && 
                        middle.isExtended && 
                        !ring.isExtended && 
                        !pinky.isExtended &&
                        (middle.tipToMcp > ring.tipToMcp + 0.08 || middle.tipToWrist > ring.tipToWrist * 1.06);

    if (isTwoFinger) {
      const extScore = (clamp((index.tipToMcp - 0.40) / 0.30, 0.6, 1.0) + clamp((middle.tipToMcp - 0.40) / 0.30, 0.6, 1.0)) / 2;
      const conf = Math.round(extScore * 100);
      return { rawGesture: GESTURES.TWO_FINGER, rawConfidence: Math.min(99, Math.max(75, conf)) };
    }

    // 3. OPEN_PALM: All or most fingers extended
    const isPalm = (index.isExtended && middle.isExtended && ring.isExtended && pinky.isExtended) ||
                   (index.isExtended && middle.isExtended && ring.isExtended && pinky.tipToMcp > 0.42);

    if (isPalm) {
      const avgExt = (index.tipToMcp + middle.tipToMcp + ring.tipToMcp + pinky.tipToMcp) / 4;
      const conf = Math.round(clamp((avgExt - 0.45) / 0.25, 0.7, 1.0) * 100);
      return { rawGesture: GESTURES.OPEN_PALM, rawConfidence: Math.min(99, Math.max(75, conf)) };
    }

    // 4. FIST: All fingers folded/curled
    const isFist = (!index.isExtended && !middle.isExtended && !ring.isExtended && !pinky.isExtended) ||
                   (index.isFolded && middle.isFolded && ring.isFolded);

    if (isFist) {
      const avgFold = (clamp((0.55 - index.tipToMcp) / 0.25, 0.6, 1.0) +
                       clamp((0.55 - middle.tipToMcp) / 0.25, 0.6, 1.0) +
                       clamp((0.55 - ring.tipToMcp) / 0.25, 0.6, 1.0) +
                       clamp((0.55 - pinky.tipToMcp) / 0.25, 0.6, 1.0)) / 4;
      const conf = Math.round(avgFold * 100);
      return { rawGesture: GESTURES.FIST, rawConfidence: Math.min(99, Math.max(75, conf)) };
    }

    // Fallback
    return { rawGesture: GESTURES.UNKNOWN, rawConfidence: 0 };
  }

  /**
   * Tracks hand position across recent frames to detect fast horizontal swipes.
   * @param {Array} landmarks 21 MediaPipe hand landmarks.
   * @param {number} timestamp Current performance timestamp in ms.
   * @returns {string|null} 'LEFT' | 'RIGHT' | null
   */
  detectSwipe(landmarks, timestamp = performance.now()) {
    if (!landmarks || landmarks.length < 21) {
      if (this.positionHistory.length > 0 && timestamp - this.positionHistory[this.positionHistory.length - 1].timestamp > 300) {
        this.positionHistory = [];
      }
      return null;
    }

    // Palm centroid
    const palmX = (landmarks[0].x + landmarks[5].x + landmarks[9].x + landmarks[17].x) / 4;
    const palmY = (landmarks[0].y + landmarks[5].y + landmarks[9].y + landmarks[17].y) / 4;

    this.positionHistory.push({ x: palmX, y: palmY, timestamp });

    // Keep rolling window of ~250ms
    while (this.positionHistory.length > 0 && timestamp - this.positionHistory[0].timestamp > 250) {
      this.positionHistory.shift();
    }

    if (this.positionHistory.length < 4) {
      return null;
    }

    if (timestamp - this.lastSwipeTime < this.swipeCooldown) {
      return null;
    }

    const oldest = this.positionHistory[0];
    const newest = this.positionHistory[this.positionHistory.length - 1];
    const timeDelta = newest.timestamp - oldest.timestamp;

    if (timeDelta < 80) {
      return null;
    }

    const dx = newest.x - oldest.x;
    const dy = newest.y - oldest.y;
    const minDx = 0.12;

    if (Math.abs(dx) > minDx && Math.abs(dx) > Math.abs(dy) * 1.3) {
      // Mirrored coordinates: dx < 0 is User SWIPE RIGHT, dx > 0 is User SWIPE LEFT
      const direction = dx < 0 ? 'RIGHT' : 'LEFT';
      this.lastSwipeTime = timestamp;
      this.lastSwipe = { direction, timestamp };
      this.positionHistory = [];
      console.log(`[Gesture Analyzer] Swipe Detected: SWIPE_${direction}`);
      return direction;
    }

    return null;
  }
}
