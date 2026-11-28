# encoding: UTF-8
# Location data for each building, from government sources, cached in data/buildings.json.
#   OneMap (SLA): address lookup, planning area, Census 2020 population and industry profile, public-transport routing
#   data.gov.sg (LTA): MRT station exits                 LTA DataMall: bus stops, monthly bus tap-outs
# Logins come from the macOS Keychain (service "esthertxe-site": onemap-email, onemap-password, lta-key) and are
# never written to disk or printed. Only public results are cached and published. A source that fails is skipped.
require "json"
require "net/http"
require "uri"
require "open3"
require "date"
require "fileutils"
require "tmpdir"
require_relative "fetched"

module Geo
  module_function

  CACHE = "data/buildings.json"
  MRT_FILE = "data/mrt-exits.geojson"
  BUS_FILE = "data/bus-stops.json"
  PV_FILE = "data/bus-volume.json"
  DESTINATIONS = {
    "Raffles Place" => [1.2840, 103.8514], "Changi Airport" => [1.3592, 103.9894], "Jurong East" => [1.3331, 103.7422],
    "Woodlands Checkpoint" => [1.4454, 103.7690], "Tuas Checkpoint" => [1.3482, 103.6359], "PSA Pasir Panjang" => [1.2737, 103.7740]
  }

  # On the GitHub rebuild job the logins come from repository secrets (environment variables) instead of the Keychain
  def secret(account)
    env = ENV[account.upcase.tr("-", "_")]
    return env unless env.to_s.empty?
    return nil unless system("which security > /dev/null 2>&1")
    out, st = Open3.capture2("security", "find-generic-password", "-s", "esthertxe-site", "-a", account, "-w")
    st.success? ? out.strip : nil
  end

  def http_get(url, headers = {}, timeout = 30)
    uri = URI(url)
    Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https", open_timeout: 15, read_timeout: timeout) do |h|
      res = h.get(uri.request_uri, { "User-Agent" => "Mozilla/5.0 (static site build)", "Accept" => "application/json" }.merge(headers))
      raise "HTTP #{res.code} from #{uri.host}" unless res.code =~ /\A2/
      res.body
    end
  end

  def http_post_json(url, body)
    uri = URI(url)
    Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: 15, read_timeout: 30) do |h|
      res = h.post(uri.request_uri, JSON.generate(body), "Content-Type" => "application/json", "User-Agent" => "Mozilla/5.0 (static site build)")
      raise "HTTP #{res.code} from #{uri.host}" unless res.code == "200"
      JSON.parse(res.body)
    end
  end

  def onemap_token
    @token ||= begin
      email, pw = secret("onemap-email"), secret("onemap-password")
      raise "OneMap login not found in Keychain" unless email && pw
      t = http_post_json("https://www.onemap.gov.sg/api/auth/post/getToken", { "email" => email, "password" => pw })["access_token"]
      raise "OneMap did not return a token (check the email and password)" unless t
      t
    end
  end

  def onemap(path, params)
    q = URI.encode_www_form(params)
    JSON.parse(http_get("https://www.onemap.gov.sg#{path}?#{q}", { "Authorization" => onemap_token }))
  ensure
    sleep 0.3 # stay well under OneMap's rate limit
  end

  def dist_m(a, b)
    r = 6_371_000.0
    dlat = (b[0] - a[0]) * Math::PI / 180; dlon = (b[1] - a[1]) * Math::PI / 180
    x = Math.sin(dlat / 2)**2 + Math.cos(a[0] * Math::PI / 180) * Math.cos(b[0] * Math::PI / 180) * Math.sin(dlon / 2)**2
    2 * r * Math.asin(Math.sqrt(x))
  end

  def fresh?(file, days) Fetched.fresh?(file, days) end

  # ---------- shared datasets ----------
  def mrt_exits
    @mrt ||= begin
      unless fresh?(MRT_FILE, 30)
        base = "https://api-open.data.gov.sg/v1/public/api/datasets/d_b39d3a0871985372d7e1637193335da5"
        url = nil
        5.times do
          meta = JSON.parse(http_get("#{base}/poll-download"))
          break if (url = meta.dig("data", "url"))
          http_get("#{base}/initiate-download") rescue nil
          sleep 3
        end
        raise "MRT exits download not ready" unless url
        File.write(MRT_FILE, http_get(url, {}, 60))
        Fetched.mark(MRT_FILE)
      end
      JSON.parse(File.read(MRT_FILE))["features"].map { |f|
        props = f["properties"]
        name = props["STATION_NA"] || props["Description"].to_s[/STATION_NA<\/th>\s*<td>([^<]+)/, 1]
        lon, lat = f["geometry"]["coordinates"]
        name ? [name.split.map(&:capitalize).join(" ").sub(/ Mrt Station\z/i, "").sub(/ Lrt Station\z/i, " LRT"), [lat, lon]] : nil
      }.compact
    end
  end

  def lta_key
    @lta ||= secret("lta-key") or raise "LTA key not found in Keychain"
  end

  def bus_stops
    @bus ||= begin
      unless fresh?(BUS_FILE, 30)
        all = []; skip = 0
        loop do
          page = JSON.parse(http_get("https://datamall2.mytransport.sg/ltaodataservice/BusStops?$skip=#{skip}", { "AccountKey" => lta_key }))["value"]
          break if page.nil? || page.empty?
          all += page.map { |s| { "code" => s["BusStopCode"], "name" => s["Description"], "road" => s["RoadName"], "lat" => s["Latitude"], "lon" => s["Longitude"] } }
          skip += 500
        end
        raise "no bus stops returned" if all.empty?
        File.write(BUS_FILE, JSON.generate(all))
        Fetched.mark(BUS_FILE)
      end
      JSON.parse(File.read(BUS_FILE))
    end
  end

  # Average daily tap-outs per bus stop, weekday and weekend/holiday, for the latest month LTA has published
  def bus_volume
    @pv ||= begin
      cached = File.exist?(PV_FILE) ? JSON.parse(File.read(PV_FILE)) : nil
      month = nil
      unless cached && fresh?(PV_FILE, 20)
        [1, 2, 3].each do |back|
          m = (Date.today << back).strftime("%Y%m")
          begin
            link = JSON.parse(http_get("https://datamall2.mytransport.sg/ltaodataservice/PV/Bus?Date=#{m}", { "AccountKey" => lta_key }))["value"].first["Link"]
            Dir.mktmpdir do |dir|
              File.binwrite("#{dir}/pv.zip", http_get(link, {}, 120))
              system("unzip", "-q", "-o", "#{dir}/pv.zip", "-d", dir) or raise "unzip failed"
              csv = Dir.glob("#{dir}/**/*.csv").first or raise "no CSV in zip"
              d = Date.strptime(m, "%Y%m"); days = (d...(d >> 1)).to_a
              wk = days.count { |x| (1..5).cover?(x.wday) }; we = days.size - wk
              sums = Hash.new { |hh, k| hh[k] = [0, 0] }
              File.foreach(csv).drop(1).each do |line|
                c = line.strip.split(",")  # YEAR_MONTH,DAY_TYPE,TIME_PER_HOUR,PT_TYPE,PT_CODE,TOTAL_TAP_IN_VOLUME,TOTAL_TAP_OUT_VOLUME
                i = c[1] =~ /WEEKDAY/ ? 0 : 1
                sums[c[4].delete('"')][i] += c[6].to_i
              end
              cached = { "month" => m, "stops" => sums.map { |k, (a, b)| [k, [(a.to_f / wk).round, (b.to_f / we).round]] }.to_h }
            end
            File.write(PV_FILE, JSON.generate(cached))
            Fetched.mark(PV_FILE)
            break
          rescue StandardError => e
            warn "Bus volumes for #{m}: #{e.message}"
          end
        end
      end
      cached
    end
  end

  # ---------- per building ----------
  def geocode(query)
    r = onemap("/api/common/elastic/search", searchVal: query, returnGeom: "Y", getAddrDetails: "Y", pageNum: 1)["results"].to_a.first
    r && r["LATITUDE"] ? { "lat" => r["LATITUDE"].to_f, "lon" => r["LONGITUDE"].to_f, "postal" => (r["POSTAL"] =~ /\A\d{6}\z/ ? r["POSTAL"] : nil),
                           "found" => r["ADDRESS"].to_s.split.map(&:capitalize).join(" ") } : nil
  end

  def pt_minutes(from, to, mode)
    # Weekday 08:30 next Tuesday, so timetables are typical
    day = Date.today + ((2 - Date.today.wday) % 7 + 7)
    params = { start: from.join(","), end: to.join(","), routeType: mode == "walk" ? "walk" : "pt" }
    params.merge!(date: day.strftime("%m-%d-%Y"), time: "08:30:00", mode: "TRANSIT", maxWalkDistance: 1000, numItineraries: 1) unless mode == "walk"
    j = onemap("/api/public/routingsvc/route", params)
    secs = mode == "walk" ? j.dig("route_summary", "total_time") : j.dig("plan", "itineraries", 0, "duration")
    secs ? (secs.to_f / 60).round : nil
  rescue StandardError
    nil
  end

  def population(lat, lon)
    area = onemap("/api/public/popapi/getPlanningarea", latitude: lat, longitude: lon, year: 2019)
    area = area.is_a?(Array) ? area.first : area
    name = area && (area["pln_area_n"] || area["planning_area"])
    return nil unless name
    out = { "planning_area" => name.split.map(&:capitalize).join(" ") }
    ages = onemap("/api/public/popapi/getPopulationAgeGroup", planningArea: name, year: 2020)
    ages = ages.find { |x| x["gender"].to_s =~ /total/i } || ages.first if ages.is_a?(Array)
    if ages.is_a?(Hash)
      v = ->(k) { ages[k].to_i }
      young = %w[age_0_4 age_5_9 age_10_14 age_15_19].sum { |k| v.(k) }
      work = %w[age_20_24 age_25_29 age_30_34 age_35_39 age_40_44 age_45_49 age_50_54 age_55_59 age_60_64].sum { |k| v.(k) }
      old = %w[age_65_69 age_70_74 age_75_79 age_80_84 age_85_over].sum { |k| v.(k) }
      total = young + work + old
      out["residents"] = total if total > 0
      out["age_mix"] = { "Under 20" => young, "20 to 64" => work, "65 and over" => old } if total > 0
    end
    hh = onemap("/api/public/popapi/getHouseholdSize", planningArea: name, year: 2020) rescue nil
    hh = hh.first if hh.is_a?(Array)
    if hh.is_a?(Hash)
      n = hh.select { |k, _| k =~ /person/ }.values.map(&:to_i).sum
      out["households"] = n if n > 0
    end
    ind = onemap("/api/public/popapi/getIndustry", planningArea: name, year: 2020) rescue nil
    ind = ind.first if ind.is_a?(Array)
    if ind.is_a?(Hash)
      top = ind.reject { |k, _| %w[planning_area year].include?(k) }.map { |k, v| [k, v.to_i] }.sort_by { |_, v| -v }.first(3)
      out["top_industries"] = top.map { |k, v| [k.tr("_", " ").capitalize, v] } if top.any? { |_, v| v > 0 }
    end
    out
  rescue StandardError => e
    warn "  population: #{e.message}"
    nil
  end

  def enrich_one(query)
    g = geocode(query) or return nil
    here = [g["lat"], g["lon"]]
    rec = g.merge("query" => query, "fetched" => Date.today.to_s)
    # Nearest 2 MRT/LRT stations (by nearest exit), with walking time
    best = {}
    mrt_exits.each { |name, pt| d = dist_m(here, pt); best[name] = [d, pt] if !best[name] || d < best[name][0] }
    rec["mrt"] = best.sort_by { |_, (d, _)| d }.first(2).map { |name, (d, pt)|
      { "name" => name, "metres" => d.round(-1), "walk_min" => pt_minutes(here, pt, "walk") || (d * 1.3 / 80).round }
    }
    rec["travel"] = DESTINATIONS.map { |n, pt| [n, pt_minutes(here, pt, "pt")] }.select { |_, m| m }.to_h
    rec["population"] = population(*here)
    rec
  end

  # Bus stops within 400 m, with average daily tap-outs; computed at build time from the shared datasets
  def buses(rec)
    begin
      stops = bus_stops
    rescue StandardError
      return nil
    end
    pv = begin
      bus_volume
    rescue StandardError
      nil
    end
    here = [rec["lat"], rec["lon"]]
    near = stops.map { |s| [s, dist_m(here, [s["lat"], s["lon"]])] }.select { |_, d| d <= 400 }.sort_by(&:last)
    list = near.map { |s, d| v = pv && pv["stops"][s["code"]]; { "code" => s["code"], "name" => s["name"], "road" => s["road"], "metres" => d.round(-1), "weekday" => v && v[0], "weekend" => v && v[1] } }
    { "stops" => list, "month" => pv && pv["month"] }
  end

  # Fetch anything missing for these buildings (query = address or building name). Returns the cache hash.
  def enrich(queries)
    cache = File.exist?(CACHE) ? JSON.parse(File.read(CACHE)) : {}
    todo = queries.uniq.reject { |q| cache[q] }
    unless todo.empty?
      puts "Location data: fetching #{todo.size} building(s)..."
      begin
        onemap_token
        todo.each_with_index do |q, i|
          rec = enrich_one(q)
          cache[q] = rec || { "query" => q, "not_found" => true, "fetched" => Date.today.to_s }
          puts "  #{i + 1}/#{todo.size} #{q}: #{rec ? "ok" : "not found"}"
          File.write(CACHE, JSON.pretty_generate(cache)) if (i % 10).zero?
        end
      rescue StandardError => e
        warn "Location data: stopped (#{e.message}). Pages are built without it for the remaining buildings."
      end
      File.write(CACHE, JSON.pretty_generate(cache))
    end
    cache
  end
end
