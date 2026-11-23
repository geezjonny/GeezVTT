// Keep movement cardinal, as required by the shared player movement rules.
export function cameraStep([x, y], yaw) {
  yaw = Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
  return [Math.round(x * Math.cos(yaw) + y * Math.sin(yaw)),
    Math.round(y * Math.cos(yaw) - x * Math.sin(yaw))];
}
