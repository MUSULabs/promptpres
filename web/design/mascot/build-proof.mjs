import { writeFile } from "node:fs/promises";

// The approved master supplies the proportions. Keep this torso across every pose.
const torso = `M146 110 148 58
  C148 30 165 16 193 16h6c26 0 41 14 41 41l2 46 33-17
  c21-12 40-7 55 9 16 17 16 40-3 58l-47 46 37 48
  c17 19 14 43-2 60-14 15-32 16-48 8l-27-13v31
  c0 21-14 32-42 32-25 0-42-12-42-33v-33l-36 16
  c-21 11-42 7-56-7-14-14-15-34 0-55l34-52-34-20
  c-29-17-32-43-15-66 19-25 38-35 63-24Z`;

const leftArm = `M103 197c-34 3-74 15-81 42
  -6 23 11 41 37 49l9-27c-10-4-19-9-17-15
  3-10 24-16 45-20Z`;
const legs = `M133 288l55-12-32 99c-3 12-16 13-42 13-19 0-31-2-31-13
  0-14 15-23 39-23Z
  M193 277l46 10 6 63c22-2 37 6 38 22 1 13-11 15-36 15
  -22 0-38-1-40-12Z`;
// Face shapes and the space between the feet cut through the entire silhouette.
const stanceCut = "M182 283q7-7 13-2l15 109h-58Z";
const smile = `M180 195c14 2 31 1 46-2 5-1 7 2 6 7
  -3 21-15 37-30 37-15 0-26-13-30-31-2-8 1-12 8-11Z`;

const poses = [
  {
    key: "default",
    gesture: `M277 216c16 8 29 15 42 3-3-9 1-21 10-26
      2-10 4-22 10-30 4-6 13-5 17 0 4 6 0 15-3 24
      6-1 11 2 14 7 6 3 8 10 6 17-1 7-4 12-9 15
      -4 10-12 14-22 12-13 14-32 21-52 13Z`,
    face: `<ellipse cx="169.5" cy="157" rx="16.5" ry="27"/>
      <ellipse cx="230" cy="154" rx="15.5" ry="26.5"/>
      <path d="${smile}"/>`,
  },
  {
    key: "guiding",
    gesture: `M268 177c19-1 37-9 51-17 16-15 34-18 56-20
      10-1 18 2 18 9 0 8-12 13-29 18 5 8 4 19-2 25
      -7 8-23 9-32 1-13 3-31 11-52 23Z`,
    face: `<ellipse cx="173" cy="156" rx="16.3" ry="26.6" transform="rotate(-4 173 156)"/>
      <ellipse cx="233" cy="148.5" rx="15.6" ry="25.6" transform="rotate(-4 233 148.5)"/>
      <path d="${smile}" transform="rotate(-6 201 210)"/>`,
  },
  { key: "silhouette" },
];

function svg({ key, gesture, face }) {
  const anatomy = gesture ? `
    <use href="#torso"/>
    <path d="${leftArm}"/>
    <path d="${legs}"/>
    <path d="${gesture}"/>` : `<use href="#torso"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 408 400">
  <title>P’Pre — ${key}</title>
  <defs>
    <path id="torso" d="${torso}"/>
    <g id="figure">${anatomy}</g>${face ? `
    <mask id="face-cutouts" x="0" y="0" width="408" height="400" maskUnits="userSpaceOnUse">
      <use href="#figure" fill="white"/>
      <g fill="black">
        <path d="${stanceCut}"/>
        ${face}
      </g>
    </mask>` : ""}
  </defs>
  <use href="#figure" fill="#2823EF"${face ? ' mask="url(#face-cutouts)"' : ""}/>
</svg>
`;
}

await Promise.all(poses.map((pose) =>
  writeFile(new URL(`ppre-${pose.key}.svg`, import.meta.url), svg(pose), "utf8"),
));
