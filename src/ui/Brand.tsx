import Image from "next/image";
export default function Brand({
  href = "/",
  className = "",
}: {
  href?: string;
  className?: string;
}) {
  return (
    <a href={href} className={`brand ${className}`} aria-label="Workspace home">
      <Image src="/icon.svg" width={34} height={34} alt="" unoptimized />
      <span>Workspace</span>
    </a>
  );
}
