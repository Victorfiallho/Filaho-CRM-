// Approximation of the Fialho CRM brand mark (angular orange "F") — not a
// pixel-exact reproduction of the official logo file, just a close geometric
// stand-in until the real asset is dropped into web/public/.
export default function FialhoMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path fill="#f97316" d="M22 14 L88 14 L70 34 L22 34 Z" />
      <path fill="#f97316" d="M22 34 L40 34 L40 90 L22 74 Z" />
      <path fill="#f97316" d="M22 50 L68 50 L50 70 L22 70 Z" />
    </svg>
  );
}
