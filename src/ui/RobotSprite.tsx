import styles from "./RobotSprite.module.css";
export type RobotPose =
  | "idle"
  | "wave"
  | "celebrate"
  | "working"
  | "sleep"
  | "saved";
export default function RobotSprite({
  pose = "idle",
  animated = false,
  className = "",
}: {
  pose?: RobotPose;
  animated?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`${styles.robot} ${className}`}
      data-pose={pose}
      data-animated={animated}
    >
      <span className={styles.sprite} />
    </span>
  );
}
