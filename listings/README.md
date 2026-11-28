# Listings

Each listing is one file here, `listings/<slug>.json`. Running `./build.sh` does the following for each file:

- builds the listing page at `/<type>/<slug>.html`, e.g. `/residential/the-sail-2-bed.html`
- puts a card for the listing in the For sale or For lease column of `residential.html`, `industrial.html` or `commercial.html`; until a column has a listing, it shows the "Ask for listings" note
- adds the page to `sitemap.xml`

The slug is the file name, so use lowercase words joined by hyphens, e.g. `bayshore-park-common-room.json`.

## Photos

1. Put the original photos in `assets/listings/<slug>/`. This folder stays on your Mac and is not uploaded.
2. Name the files in the order you want them shown, e.g. `01-living.jpg`, `02-kitchen.jpg`. JPG, PNG, HEIC and WebP all work.
3. The build resizes them to `img/listings/<slug>/01.jpg`, `02.jpg` and so on (longest side 1600px). Those resized copies are what goes on the site.

The first photo is used on the card and when the page is shared. The page gallery shows up to five photos, with links to the rest.

## Fields

Required:

| Field | Example | Notes |
|---|---|---|
| `type` | `"residential"` | `residential`, `industrial` or `commercial` |
| `deal` | `"sale"` | `sale` or `lease` |
| `name` | `"The Sail @ Marina Bay"` | |
| `subtype` | `"Condominium"` | e.g. HDB 4-room, Room (common), Warehouse, Office, Shop |
| `address` | `"2 Marina Boulevard"` | |
| `price` | `1850000` | Sale: asking price. Lease: monthly rent. Numbers only. |
| `updated` | `"2026-11-28"` | Shown as "Details as at" |

Optional. Leave out anything you don't have and that row won't appear:

| Field | Example | Notes |
|---|---|---|
| `status` | `"available"` | `available` (default), `under-offer`, `sold` or `let` |
| `postal_code` | `"018987"` | |
| `district` | `"D01 · Marina Bay"` | |
| `size_sqft` | `1001` | Sale listings also show the price per sq ft |
| `bedrooms`, `bathrooms` | `3`, `2` | |
| `tenure` | `"99-year leasehold from 2004"` | |
| `top` | `2008` | Year the building was completed |
| `furnishing` | `"Partially furnished"` | |
| `available` | `"1 March 2027"` | |
| `mrt` | `"Downtown MRT, 5 minutes' walk"` | |
| `lease_months` | `12` | Lease listings: turns on the "Cost to move in" estimate |
| `deposit_months` | `2` | Lease listings: by default, one month per year of lease |
| `expected_rent` | `5200` | Sale listings: fills in the rent on the cashflow calculator link |
| `summary` | `"…"` | One sentence for search engines and link previews |
| `highlights` | `["High floor", "Sea view"]` | Short tags |
| `description` | `["Paragraph one", "Paragraph two"]` | |
| `facilities` | `["Pool", "Gym"]` | |
| `photo_alts` | `["Living room facing the sea"]` | Descriptions of the photos, in order, for accessibility |
| `faq` | `[["Is it tenanted?", "Yes, until June 2027."]]` | Added to the page's question list |
| `listed` | `"2026-11-28"` | Date first listed |

## Removing or closing a listing

- To keep a listing up as sold or let, set `"status": "sold"` or `"let"`. The card gets a badge and sorts after the available listings.
- To take a listing down, delete its `.json` file and run `./build.sh`. The build removes the page.

## Previewing

Files starting with `_` (`_sample-condo.json`, `_sample-room.json`) are made-up samples that show the format. They are only built with `PREVIEW=1 ./build.sh`, for checking the layout locally. Run a plain `./build.sh` before committing, so the samples don't end up on the type pages.
