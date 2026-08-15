import { describe, it, expect } from 'vitest';
import { GestureAnalyzer, GESTURES } from './gestures.js';

// Helper to create synthetic 21 landmarks based on finger states
function createMockHand(fingerStates = { index: true, middle: false, ring: false, pinky: false }) {
  // Wrist at (0.5, 0.8, 0.0)
  const landmarks = [
    { x: 0.5, y: 0.8, z: 0.0 }, // 0: Wrist
    { x: 0.45, y: 0.75, z: 0.0 }, // 1: Thumb CMC
    { x: 0.42, y: 0.70, z: 0.0 }, // 2: Thumb MCP
    { x: 0.40, y: 0.65, z: 0.0 }, // 3: Thumb IP
    { x: 0.38, y: 0.60, z: 0.0 }, // 4: Thumb Tip
  ];

  // Index (5, 6, 7, 8)
  landmarks.push({ x: 0.45, y: 0.60, z: 0.0 }); // 5: Index MCP
  landmarks.push({ x: 0.45, y: 0.50, z: 0.0 }); // 6: Index PIP
  landmarks.push({ x: 0.45, y: 0.42, z: 0.0 }); // 7: Index DIP
  landmarks.push(fingerStates.index 
    ? { x: 0.45, y: 0.30, z: 0.0 } // 8: Extended
    : { x: 0.45, y: 0.58, z: 0.0 } // 8: Folded
  );

  // Middle (9, 10, 11, 12)
  landmarks.push({ x: 0.50, y: 0.58, z: 0.0 }); // 9: Middle MCP
  landmarks.push({ x: 0.50, y: 0.48, z: 0.0 }); // 10: Middle PIP
  landmarks.push({ x: 0.50, y: 0.40, z: 0.0 }); // 11: Middle DIP
  landmarks.push(fingerStates.middle 
    ? { x: 0.50, y: 0.28, z: 0.0 } // 12: Extended
    : { x: 0.50, y: 0.56, z: 0.0 } // 12: Folded
  );

  // Ring (13, 14, 15, 16)
  landmarks.push({ x: 0.55, y: 0.60, z: 0.0 }); // 13: Ring MCP
  landmarks.push({ x: 0.55, y: 0.50, z: 0.0 }); // 14: Ring PIP
  landmarks.push({ x: 0.55, y: 0.43, z: 0.0 }); // 15: Ring DIP
  landmarks.push(fingerStates.ring 
    ? { x: 0.55, y: 0.32, z: 0.0 } // 16: Extended
    : { x: 0.55, y: 0.58, z: 0.0 } // 16: Folded
  );

  // Pinky (17, 18, 19, 20)
  landmarks.push({ x: 0.60, y: 0.63, z: 0.0 }); // 17: Pinky MCP
  landmarks.push({ x: 0.60, y: 0.55, z: 0.0 }); // 18: Pinky PIP
  landmarks.push({ x: 0.60, y: 0.49, z: 0.0 }); // 19: Pinky DIP
  landmarks.push(fingerStates.pinky 
    ? { x: 0.60, y: 0.40, z: 0.0 } // 20: Extended
    : { x: 0.60, y: 0.61, z: 0.0 } // 20: Folded
  );

  return landmarks;
}

describe('GestureAnalyzer', () => {
  it('should accurately recognize POINT gesture when index is extended and others folded', () => {
    const analyzer = new GestureAnalyzer(5, 3);
    const pointHand = createMockHand({ index: true, middle: false, ring: false, pinky: false });

    // Single frame classify test
    const rawResult = analyzer.classify(pointHand);
    expect(rawResult.rawGesture).toBe(GESTURES.POINT);
    expect(rawResult.rawConfidence).toBeGreaterThanOrEqual(75);

    // Stream analyze test over frames
    let result;
    for (let i = 0; i < 6; i++) {
      result = analyzer.analyze(pointHand);
    }
    expect(result.gesture).toBe(GESTURES.POINT);
    expect(result.confidence).toBeGreaterThanOrEqual(75);
  });

  it('should accurately recognize OPEN_PALM when all fingers are extended', () => {
    const analyzer = new GestureAnalyzer(5, 3);
    const palmHand = createMockHand({ index: true, middle: true, ring: true, pinky: true });

    const rawResult = analyzer.classify(palmHand);
    expect(rawResult.rawGesture).toBe(GESTURES.OPEN_PALM);
    expect(rawResult.rawConfidence).toBeGreaterThanOrEqual(75);
  });

  it('should accurately recognize FIST when all fingers are folded', () => {
    const analyzer = new GestureAnalyzer(5, 3);
    const fistHand = createMockHand({ index: false, middle: false, ring: false, pinky: false });

    const rawResult = analyzer.classify(fistHand);
    expect(rawResult.rawGesture).toBe(GESTURES.FIST);
    expect(rawResult.rawConfidence).toBeGreaterThanOrEqual(75);
  });

  it('should accurately recognize TWO_FINGER when index and middle are extended', () => {
    const analyzer = new GestureAnalyzer(5, 3);
    const peaceHand = createMockHand({ index: true, middle: true, ring: false, pinky: false });

    const rawResult = analyzer.classify(peaceHand);
    expect(rawResult.rawGesture).toBe(GESTURES.TWO_FINGER);
    expect(rawResult.rawConfidence).toBeGreaterThanOrEqual(75);
  });
});
