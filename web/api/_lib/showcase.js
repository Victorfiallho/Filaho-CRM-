// Copy, photos and videos for the booking page, keyed by the service (or
// service group) name as typed in the CRM, case-insensitive. A service the
// company offers that isn't listed here still gets a block, just with no
// photos. Files live in web/public/work/.
const photos = (dir, alts) => alts.map((alt, i) => ({ src: `/work/${dir}/${i + 1}.jpg`, alt }));

// Muted clips the page hero plays in turn, by kind of work.
const CABINET_VIDEOS = [
  { src: "/work/videos/1.mp4", poster: "/work/videos/1.jpg", alt: "Walkthrough of a white shaker kitchen with inset range hood" },
  { src: "/work/videos/2.mp4", poster: "/work/videos/2.jpg", alt: "Built-in coffee bar cabinet with a microwave and butcher block top" }
];
const CLEANING_VIDEOS = [
  { src: "/work/videos/cleaning/1.mp4", poster: "/work/videos/cleaning/1.jpg", alt: "Technician cleaning a light carpet in a bright living room" },
  { src: "/work/videos/cleaning/2.mp4", poster: "/work/videos/cleaning/2.jpg", alt: "Freshly cleaned carpet with clean lines in a living room with a fireplace" }
];

const UPHOLSTERY = {
  blurb: "Sofas, sectionals, chairs and mattresses cleaned on site, gentle on the fabric and tough on stains and odors.",
  videos: CLEANING_VIDEOS,
  photos: photos("upholstery-cleaning", [
    "Light gray sectional sofa after cleaning",
    "Large light gray sectional sofa and area rug after cleaning"
  ])
};

export const SHOWCASE = {
  "carpet cleaning": {
    blurb: "Deep shampoo or a quick refresh: we lift dirt, stains and odors and leave your carpets soft and clean.",
    videos: CLEANING_VIDEOS,
    photos: photos("carpet-cleaning", [
      "Freshly cleaned carpet with even lines in an empty room",
      "Bedroom carpet right after a deep clean",
      "Living room carpet cleaned around a recliner sofa"
    ])
  },
  "house cleaning": {
    blurb: "One-time, deep or recurring cleans: kitchens, bathrooms and every room left spotless.",
    videos: CLEANING_VIDEOS,
    photos: photos("house-cleaning", [
      "Clean bathroom with a green vanity, granite top and white tile tub",
      "Clean kitchen with green cabinets and stainless appliances",
      "Clean empty bedroom with shiny hardwood floors"
    ])
  },
  "upholstery cleaning": UPHOLSTERY,
  "uphostery cleaning": UPHOLSTERY,
  "kitchen remodeling": {
    videos: CABINET_VIDEOS,
    blurb: "Full kitchen makeovers: new cabinet layouts, islands, uppers to the ceiling and everything ready for countertops.",
    photos: photos("kitchen-remodeling", [
      "White kitchen remodel with glass-front uppers, wall ovens and gold pulls",
      "White shaker kitchen with marble-look counters and a sculpted tile backsplash",
      "White kitchen wall with glass-front uppers, a wine rack and a dark island"
    ])
  },
  "bathroom remodeling": {
    videos: CABINET_VIDEOS,
    blurb: "Vanities, linen cabinets and storage built to fit your bathroom, installed level and ready for tops and fixtures.",
    photos: photos("bathroom-remodeling", [
      "White double vanity with drawers and brushed gold hardware",
      "Gray shaker vanity in a powder room"
    ])
  },
  "custom cabinetry": {
    videos: CABINET_VIDEOS,
    blurb: "Cabinets made to measure for kitchens, laundry rooms, closets and built-ins, in the style and finish you choose.",
    photos: photos("custom-cabinetry", [
      "Custom oak mudroom built-in with bench, paneled back and upper cabinets",
      "Custom oak mudroom built-in with a tall storage cabinet beside the bench",
      "Custom oak pantry cabinets floor to ceiling around a window, with a base cabinet between them"
    ])
  },
  "cabinets installation": {
    videos: CABINET_VIDEOS,
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

// Names pasted from chat apps can carry invisible characters (zero-width
// spaces, word joiners) that would otherwise break the lookup.
const key = name => String(name || "").replace(/\p{Cf}/gu, "").trim().toLowerCase();
export const showcaseFor = name => SHOWCASE[key(name)] || null;

// The hero's clips for the work a page offers, each clip once.
export function videosFor(names) {
  const seen = new Set();
  return names.flatMap(n => showcaseFor(n)?.videos || []).filter(v => (seen.has(v.src) ? false : seen.add(v.src)));
}
