#!/bin/bash
# Crops/resizes photos in ./assets with sips, then writes ./index.html with images inlined as base64.
# Usage: ./build.sh   (put the four source photos in ./assets first)
set -euo pipefail
cd "$(dirname "$0")"
A=assets; B=assets/build; mkdir -p "$B"

w(){ sips -g pixelWidth  "$1" | awk '/pixelWidth/{print $2}'; }
h(){ sips -g pixelHeight "$1" | awk '/pixelHeight/{print $2}'; }
jpg(){ sips -s format jpeg -s formatOptions "${3:-80}" "$1" --out "$2" >/dev/null; }

if [ -f "$A/esther-sepia.jpg" ]; then
  # Face-free crop x 850-1650, y 700-1500 (on the 2250x1500 original)
  sips -c 800 800 --cropOffset 700 850 "$A/esther-sepia.jpg" --out "$B/sepia-crop.jpg" >/dev/null
  sips --resampleWidth 620 "$B/sepia-crop.jpg" >/dev/null; jpg "$B/sepia-crop.jpg" "$B/sepia-crop.jpg" 74
  # Hero, max 1900px wide
  sips --resampleWidth 1900 "$A/esther-sepia.jpg" --out "$B/hero.jpg" >/dev/null
  jpg "$B/hero.jpg" "$B/hero.jpg" 80
  # Social share image, 1200x630 (crop 2250x1181 from y=40, then scale)
  sips -c 1181 2250 --cropOffset 40 0 "$A/esther-sepia.jpg" --out og-image.jpg >/dev/null
  sips -z 630 1200 og-image.jpg >/dev/null
  jpg og-image.jpg og-image.jpg 82
fi
if [ -f "$A/esther-cutout.jpg" ]; then
  W=$(w "$A/esther-cutout.jpg"); H=$(h "$A/esther-cutout.jpg"); T=$(( H * 24 / 100 ))
  sips -c $(( H - T )) "$W" --cropOffset "$T" 0 "$A/esther-cutout.jpg" --out "$B/cutout.jpg" >/dev/null
  [ "$W" -gt 1000 ] && sips --resampleWidth 1000 "$B/cutout.jpg" >/dev/null
  jpg "$B/cutout.jpg" "$B/cutout.jpg" 80
elif [ -f "$A/esther-sepia.jpg" ]; then
  # No cutout supplied yet: use a 4:5 upper-body crop of the sepia portrait (x 780-1680, y 60-1185)
  sips -c 1125 900 --cropOffset 60 780 "$A/esther-sepia.jpg" --out "$B/cutout.jpg" >/dev/null
  sips --resampleWidth 680 "$B/cutout.jpg" >/dev/null
  jpg "$B/cutout.jpg" "$B/cutout.jpg" 80
fi
if [ -f "$A/interior-staircase.jpg" ]; then
  W=$(w "$A/interior-staircase.jpg"); H=$(h "$A/interior-staircase.jpg"); L=$(( W * 5 / 100 )); BT=$(( H * 7 / 100 ))
  sips -c $(( H - BT )) $(( W - L )) --cropOffset 0 "$L" "$A/interior-staircase.jpg" --out "$B/staircase.jpg" >/dev/null
  jpg "$B/staircase.jpg" "$B/staircase.jpg" 85
fi
if [ -f "$A/villa-dusk.jpg" ]; then
  W=$(w "$A/villa-dusk.jpg"); H=$(h "$A/villa-dusk.jpg")
  sips -c $(( H - 4 )) $(( W - 8 )) --cropOffset 0 0 "$A/villa-dusk.jpg" --out "$B/villa.jpg" >/dev/null
  jpg "$B/villa.jpg" "$B/villa.jpg" 85
fi

# Listing photos: assets/listings/<slug>/ -> img/listings/<slug>/ (see listings/README.md)
ruby -E UTF-8 -r ./src/listings.rb -e 'Listings.resize_photos; JTC.refresh'

# Build each page: pull in the shared CSS/JS, inline images (and set real width/height),
# and fill the For sale / For lease columns of the property-type pages with listing cards
for PAGE in index calculators residential industrial commercial; do
ruby -E UTF-8 -r ./src/listings.rb -e '
  require "base64"
  all = Listings.load(ENV["PREVIEW"] == "1")
  page = ARGV[0]
  html = File.read("src/#{page}.src.html", encoding: "UTF-8")
  html.gsub!(/\/\* @inline ([\w.-]+) \*\/\n/) { File.read("src/#{$1}", encoding: "UTF-8") }
  html = Listings.fill_markers(html, all)
  html.gsub!(/<img([^>]*?)src="(assets\/build\/[^"]+)"([^>]*)>/) do
    pre, path, post = $1, $2, $3
    if File.exist?(path)
      d = `sips -g pixelWidth -g pixelHeight "#{path}"`
      wd = d[/pixelWidth: (\d+)/,1]; ht = d[/pixelHeight: (\d+)/,1]
      tag = "<img#{pre}src=\"data:image/jpeg;base64,#{Base64.strict_encode64(File.binread(path))}\"#{post}>"
      tag.sub(/width="\d+"/, "width=\"#{wd}\"").sub(/height="\d+"/, "height=\"#{ht}\"")
    else
      warn "missing #{path} (left as a file reference)"; $&
    end
  end
  File.write("#{page}.html", html)
  puts "#{page}.html: #{(html.bytesize/1024.0).round} KB"
' "$PAGE"
done

# Listing pages (/<type>/<slug>.html) and sitemap.xml. PREVIEW=1 ./build.sh also builds listings/_*.json samples.
ruby -E UTF-8 -r ./src/listings.rb -e 'Listings.build(ENV["PREVIEW"] == "1")'
