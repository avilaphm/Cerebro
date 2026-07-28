import type { SVGProps } from "react";

type CerebroMarkProps = SVGProps<SVGSVGElement> & {
  title?: string;
};

export default function CerebroMark({
  title,
  ...props
}: CerebroMarkProps) {
  return (
    <svg
      viewBox="0 0 88 74"
      fill="none"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <g
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 33 38 12l6 35-32-14Z" />
        <path d="m38 12 32 15-26 20 32 16-6-36" />
      </g>
      <g fill="currentColor">
        <circle cx="12" cy="33" r="5.5" />
        <circle cx="38" cy="12" r="5.5" />
        <circle cx="44" cy="47" r="5.5" />
        <circle cx="70" cy="27" r="5.5" />
        <circle cx="76" cy="63" r="5.5" />
      </g>
    </svg>
  );
}
