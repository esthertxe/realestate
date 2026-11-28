# encoding: UTF-8
# Industrial, business park and office space for lease, from listings/space.csv (one row per unit).
# Settings (as-at date, which buildings are commercial, name and address fixes) are in listings/space-config.json.
# The landlord / REIT column is never read: if a sheet still has one, it is ignored here and must not be committed.
require "csv"
require "json"
require "date"

module Space
  module_function

  CONFIG = "listings/space-config.json"
  CSV_FILE = "listings/space.csv"
  BUILDING_LEVEL = ["Area", "Cargo Lift", "Passenger Lift", "Loading Bays + Dock Levelers", "Ramp Up / Flatted",
                    "Up to 20ft / 40ft (for Ramp Up)", "Carpark", "Power"]

  def config
    @config ||= JSON.parse(File.read(CONFIG, encoding: "UTF-8"))
  end

  # Download the listings Google Sheet (shared "Anyone with the link: Viewer") and save it as listings/space.csv
  # without the REIT / landlord column. The link is kept in a GitHub secret, never in this public repository.
  def pull_sheet(link)
    require "net/http"
    id = link[%r{/spreadsheets/d/([\w-]+)}, 1] or abort "SHEET_CSV_URL is not a Google Sheets link"
    gid = link[/gid=(\d+)/, 1] || "0"
    uri = URI("https://docs.google.com/spreadsheets/d/#{id}/export?format=csv&gid=#{gid}")
    body = nil
    5.times do
      res = Net::HTTP.get_response(uri)
      if res.is_a?(Net::HTTPRedirection) then uri = URI(res["location"]); next end
      abort "Google Sheet download failed (HTTP #{res.code}). Is it shared as 'Anyone with the link: Viewer'?" unless res.code == "200"
      body = res.body.force_encoding("UTF-8").sub("﻿", ""); break
    end
    abort "Google Sheet download failed (too many redirects)" unless body
    abort "The Google Sheet is not public: share it as 'Anyone with the link: Viewer'" if body.lstrip.start_with?("<")
    rows = CSV.parse(body)
    head = rows.first.map { |x| x.to_s.strip }
    keep = head.each_index.reject { |i| head[i].empty? || head[i] =~ /reit|landlord/i }
    abort "Sheet has no Building column" unless keep.any? { |i| head[i] == "Building" }
    rows = rows.select { |r| keep.any? { |i| !r[i].to_s.strip.empty? } }   # drop empty rows at the bottom of the sheet
    out = CSV.generate { |csv| rows.each { |r| csv << keep.map { |i| r[i] } } }
    if File.exist?(CSV_FILE) && File.read(CSV_FILE, encoding: "UTF-8") == out
      puts "Google Sheet: no changes"
      return
    end
    File.write(CSV_FILE, out)
    cfg = JSON.parse(File.read(CONFIG, encoding: "UTF-8"))
    cfg["as_at"] = Date.today.to_s
    File.write(CONFIG, JSON.pretty_generate(cfg) + "\n")
    puts "Google Sheet: #{rows.size - 1} rows saved to #{CSV_FILE}"
  end

  def clean(v)
    s = v.to_s.gsub(/\s+/, " ").strip
    s.empty? || %w[na n/a nil - none].include?(s.downcase) ? nil : s
  end

  def number(v)
    s = v.to_s.gsub(",", "")
    m = s.match(/\d+(?:\.\d+)?/)
    m ? m[0].to_f : nil
  end

  def slugify(s)
    s.downcase.gsub("&", " and ").gsub("@", " at ").gsub(/[^a-z0-9]+/, "-").gsub(/\A-+|-+\z/, "")
  end

  # "The Gemini (41 Science Park Road)" -> ["The Gemini", "41 Science Park Road"]; "2 Serangoon North" -> ["2 Serangoon North", "2 Serangoon North"]
  def split_building(raw)
    name = (config["names"][raw] || config["names"][raw.strip] || raw).strip
    short, addr = name, nil
    if (m = name.match(/\A(.+?)\s*\((.+)\)\s*\z/))
      short, addr = m[1].strip, m[2].strip
      if addr =~ /\A(for|build)/i              # "8 Senoko South Road (Build to Suit only)": a note, not an address
        addr = short =~ /\A\d/ ? short : nil
      elsif short =~ /\A\d/ && addr !~ /\A\d/  # "11 Lorong 3 Toa Payoh (Jackson Square)": name in brackets
        short, addr = addr, short
      end
    elsif (m = name.match(/\A(.+?)\s+-\s+(\d.+)\z/)) && name !~ /\A\d/
      short, addr = m[1].strip, m[2].strip           # "Mapletree Joo Koon Logistics Hub - 5A Joo Koon Circle"
    elsif (m = name.match(/\A(\d[^,]+),\s*(.+)\z/))
      short, addr = m[2].strip, m[1].strip           # "25 Pandan Crescent, TIC Tech Centre"
    end
    addr ||= config["addresses"][short] || config["addresses"][name]
    addr ||= name if name =~ /\A\d/
    [name, short, addr]
  end

  def commercial?(short)
    config["commercial_buildings"].any? { |b| b.casecmp(short).zero? }
  end

  def kind(type, zoning, short, name)
    t = type.to_s
    return "Commercial / retail" if t =~ /commercial|retail|f&b/i
    return "Business park" if t =~ /business park/i || config["business_park_words"].any? { |w| name.downcase.include?(w.downcase) } && t !~ /office|warehouse/i
    return "Warehouse" if t =~ /warehous|logistic|storage/i && t !~ /\Aclean/i
    return "Food factory" if t =~ /food/i || zoning.to_s =~ /food/i || name =~ /food/i
    return "Office" if t =~ /office/i && t !~ /ancillary/i || commercial?(short)
    return "Air-conditioned industrial" if t =~ /air ?con/i
    return "Industrial (#{zoning})" if zoning.to_s =~ /\AB[12]\z/
    "Industrial space"
  end

  def availability(v)
    s = clean(v)
    return [nil, "available"] unless s
    return ["On request", "available"] if s =~ /call us|tba|tbc/i
    return ["Under negotiation", "under-offer"] if s =~ /nego/i
    return ["Immediate", "available"] if s =~ /immediate/i
    if s =~ /\A(\d{4}-\d{2}-\d{2})/
      d = Date.parse($1)
      return ["From #{d.strftime("%-d %B %Y")}", "available"]
    end
    [s, "available"]
  end

  # Column names are matched loosely, so small spelling changes in the sheet ("Remarsk", "Floor Loading ()") still work.
  # Order matters: the first pattern that matches wins.
  COLUMNS = [
    ["Up to 20ft / 40ft (for Ramp Up)", /20\s*ft|40\s*ft/i], ["Floor Loading (kN/m2)", /floor\s*load/i],
    ["Loading Bays + Dock Levelers", /loading\s*bay|dock/i], ["Ramp Up / Flatted", /ramp|flatted/i],
    ["Building", /\Abuilding/i], ["Area", /\A(area|region)\b/i], ["Unit", /\Aunit/i], ["Zoning (B1/B2)", /zoning/i],
    ["Type", /\Atype/i], ["Size", /\Asize/i], ["Asking PSF", /psf/i], ["Power", /power/i],
    ["Ceiling Height (m)", /ceiling/i], ["Cargo Lift", /cargo/i], ["Passenger Lift", /passenger/i],
    ["Carpark", /car\s*park/i], ["Availability", /avail/i], ["Remarks", /\Arem/i], ["Photos", /photo/i]
  ]

  def canonical(head)
    h = head.to_s.strip
    hit = COLUMNS.find { |_, re| h =~ re }
    hit ? hit[0] : h
  end

  def rows
    path = CSV_FILE
    return [] unless File.exist?(path)
    CSV.read(path, encoding: "UTF-8", headers: true).map { |r| r.to_h.each_with_object({}) { |(k, v), o| c = canonical(k); o[c] = v unless o[c] } }
  end

  def load
    as_at = config["as_at"]
    last = {}
    used = {}
    list = []
    rows.each do |r|
      r = r.reject { |k, _| k.to_s =~ /reit|landlord/i } # never use the landlord column
      raw = clean(r["Building"]) or next
      size = number(r["Size"])
      next unless size && size > 0
      # Building-level fields are often only on the first row of each building: carry them down.
      prev = last[raw] || {}
      BUILDING_LEVEL.each { |k| r[k] = prev[k] if clean(r[k]).nil? && prev[k] }
      last[raw] = r
      name, short, addr = split_building(raw)
      unit = clean(r["Unit"]).to_s.sub(/\A(\d)/, '#\1')
      zoning = clean(r["Zoning (B1/B2)"])
      zoning = nil unless zoning.to_s =~ /\A(B1|B2)\z/i
      type_raw = clean(r["Type"])
      sub = kind(type_raw, clean(r["Zoning (B1/B2)"]), short, name)
      psf_raw = clean(r["Asking PSF"])
      psf = psf_raw && psf_raw !~ /call/i ? number(psf_raw) : nil
      psf = nil if psf && (psf <= 0 || psf > 50)
      sqft = size.round
      avail, status = availability(r["Availability"])
      page = commercial?(short) ? "commercial" : "industrial"
      base = slugify("#{short} #{unit}")[0, 80].sub(/-+\z/, "")
      used[base] = (used[base] || 0) + 1
      slug = used[base] > 1 ? "#{base}-#{used[base]}" : base
      remarks = clean(r["Remarks"])
      photos = clean(r.find { |k, _| k.to_s =~ /\APhotos/ }&.last).to_s.split(/[\s,]+/).select { |u| u =~ /\Ahttps?:\/\// }.map { |u|
        id = u[/(?:\/d\/|id=)([\w-]{20,})/, 1]
        src = u.include?("drive.google") && id ? "https://drive.google.com/thumbnail?id=#{id}&sz=w1600" : u
        { "src" => src, "w" => "1600", "h" => "1200", "alt" => "#{short} #{unit}".strip }
      }
      specs = [
        ["Zoning", zoning],
        ["Floor-to-ceiling height", clean(r["Ceiling Height (m)"]) && "#{clean(r["Ceiling Height (m)"])} m"],
        ["Floor loading", clean(r["Floor Loading (kN/m2)"]) && "#{clean(r["Floor Loading (kN/m2)"]).sub(/\.0\z/, "")} kN/m²"],
        ["Power", clean(r["Power"])],
        ["Cargo lifts", clean(r["Cargo Lift"])],
        ["Passenger lifts", clean(r["Passenger Lift"]) && clean(r["Passenger Lift"]).sub(/\.0\z/, "")],
        ["Loading bays and dock levellers", clean(r["Loading Bays + Dock Levelers"])],
        ["Ramp-up or flatted", clean(r["Ramp Up / Flatted"])],
        ["20ft / 40ft container access", clean(r["Up to 20ft / 40ft (for Ramp Up)"])],
        ["Car park", clean(r["Carpark"])]
      ].reject { |_, v| v.nil? }
      list << {
        "space" => true, "slug" => slug, "type" => page, "deal" => "lease", "status" => status,
        "building" => short, "building_full" => name, "unit" => unit,
        "name" => [short, unit].reject(&:empty?).join(", "),
        "subtype" => sub, "type_detail" => type_raw, "zoning" => zoning,
        "address" => addr, "region" => clean(r["Area"]), "size_sqft" => sqft,
        "psf" => psf, "price" => psf ? (psf * sqft).round : 0,
        "available" => avail, "remarks" => remarks,
        "description" => remarks ? [remarks] : [], "specs" => specs,
        "photos" => photos, "updated" => as_at, "listed" => as_at
      }
    end
    list
  end
end
