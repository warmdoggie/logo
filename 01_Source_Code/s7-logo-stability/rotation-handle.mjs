export function rotationHandleLocalPosition(width,height,gap=32){
  return {x:width/2+gap,y:-height/2-gap};
}

export function rotationGestureMode(durationMs,thresholdMs=350){
  return durationMs>=thresholdMs?'drag':'step';
}
