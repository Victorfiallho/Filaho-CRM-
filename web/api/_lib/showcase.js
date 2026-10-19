// Copy, photos and videos for the booking page, keyed by the service name as
// typed in the CRM (case-insensitive). A service the company offers that
// isn't listed here still gets a block, just with no photos. Files live in
// web/public/work/.
const photos = (dir, alts) => alts.map((alt, i) => ({ src: `/work/${dir}/${i + 1}.jpg`, alt }));

export const SHOWCASE = {
  "kitchen remodeling": {
    blurb: "Full kitchen makeovers: new cabinet layouts, islands, uppers to the ceiling and everything ready for countertops.",
    photos: photos("kitchen-remodeling", [
      "White kitchen remodel with glass-front uppers, wall ovens and gold pulls",
      "White shaker kitchen with marble-look counters and a sculpted tile backsplash",
      "White kitchen wall with glass-front uppers, a wine rack and a dark island"
    ])
  },
  "bathroom remodeling": {
    blurb: "Vanities, linen cabinets and storage built to fit your bathroom, installed level and ready for tops and fixtures.",
    photos: photos("bathroom-remodeling", [
      "White double vanity with drawers and brushed gold hardware",
      "Gray shaker vanity in a powder room"
    ])
  },
  "custom cabinetry": {
    blurb: "Cabinets made to measure for kitchens, laundry rooms, closets and built-ins, in the style and finish you choose.",
    photos: photos("custom-cabinetry", [
      "Custom oak mudroom built-in with bench, paneled back and upper cabinets",
      "Custom oak mudroom built-in with a tall storage cabinet beside the bench",
      "Custom oak pantry cabinets floor to ceiling around a window, with a base cabinet between them"
    ])
  },
  "cabinets installation": {
    blurb: "Already have your cabinets? We install them square, level and secure, with fillers, trim and hardware.",
    photos: photos("cabinets-installation", [
      "Dark shaker cabinets installed in an L-shaped kitchen with open shelves",
      "Dark shaker kitchen cabinets installed with a tall pantry unit",
      "Gray shaker wall and base cabinets installed in a laundry room",
      "White kitchen island cabinets being installed",
      "White island and base cabinets installed next to the refrigerator",
      "Detail of an installed white paneled island with corbels",
      "White kitchen cabinets and island being installed around the refrigerator"
    ])
  }
};

// Muted clips the page hero plays in turn.
export const GENERIC_VIDEOS = [
  { src: "/work/videos/1.mp4", poster: "/work/videos/1.jpg", alt: "Walkthrough of a white shaker kitchen with inset range hood" },
  { src: "/work/videos/2.mp4", poster: "/work/videos/2.jpg", alt: "Built-in coffee bar cabinet with a microwave and butcher block top" }
];

// Names pasted from chat apps can carry invisible characters (zero-width
// spaces, word joiners) that would otherwise break the lookup.
const key = name => String(name || "").replace(/\p{Cf}/gu, "").trim().toLowerCase();
export const showcaseFor = name => SHOWCASE[key(name)] || null;
