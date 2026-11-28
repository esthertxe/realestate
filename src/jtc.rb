# encoding: UTF-8
# JTC industrial rental and price indices (4Q 2012 = 100), from SingStat Table Builder. No key needed.
#   M212171: Rental Index of Industrial Space   M212181: Price Index of Industrial Space
# Cached in data/jtc-rental.json and data/jtc-price.json; refreshed when older than 7 days.
# If SingStat can't be reached the cached copy is used, and with no cache the charts are left out.
require "json"
require "net/http"
require "uri"
require "cgi"
require_relative "fetched"

module JTC
  module_function

  TABLES = { "rental" => "M212171", "price" => "M212181" }
  MAX_AGE = 7 * 24 * 3600

  def file(kind) "data/jtc-#{kind}.json" end

  def refresh
    TABLES.each do |kind, id|
      f = file(kind)
      next if Fetched.fresh?(f, MAX_AGE / 86_400)
      begin
        uri = URI("https://tablebuilder.singstat.gov.sg/api/table/tabledata/#{id}?limit=3000")
        res = Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: 15, read_timeout: 30) { |http|
          http.get(uri.request_uri, "User-Agent" => "Mozilla/5.0 (static site build)", "Accept" => "application/json")
        }
        raise "HTTP #{res.code}" unless res.code == "200"
        j = JSON.parse(res.body)
        raise "no rows" unless j.dig("Data", "row").is_a?(Array) && !j["Data"]["row"].empty?
        Dir.mkdir("data") unless Dir.exist?("data")
        File.write(f, res.body)
        Fetched.mark(f)
        puts "JTC #{kind} index updated (data to #{latest_key(j)})"
      rescue StandardError => e
        warn "JTC #{kind} index: could not refresh (#{e.message}); #{File.exist?(f) ? "using the cached copy" : "chart left out"}"
      end
    end
  end

  def latest_key(j) j["Data"]["row"].first["columns"].last["key"] end

  # { "All Industrial" => [["2023 4Q", 108.1], ...], ... }, plus meta
  def data(kind)
    @data ||= {}
    return @data[kind] if @data.key?(kind)
    f = file(kind)
    @data[kind] = if File.exist?(f)
      j = JSON.parse(File.read(f, encoding: "UTF-8"))["Data"]
      series = {}
      j["row"].each { |r| series[r["rowText"].strip] = r["columns"].map { |c| [c["key"], c["value"].to_f] }.reject { |_, v| v.zero? } }
      { "series" => series, "updated" => j["dataLastUpdated"], "title" => j["title"], "id" => TABLES[kind] }
    end
  end

  def segment_for(listing)
    s = listing["subtype"].to_s
    return "Business Park" if s =~ /business park/i
    return "Warehouse" if s =~ /warehouse/i
    "Multiple-User Factory"
  end

  def pct(a, b) b.to_f.zero? ? nil : ((a / b - 1) * 100) end
  def fmt_pct(v) v.nil? ? "–" : format("%+.1f%%", v).sub("+-", "−").sub("-", "−") end

  # Small line chart of the last 12 quarters
  def spark(points, label)
    w, hgt, pad = 280.0, 72.0, 4.0
    vals = points.map(&:last)
    lo, hi = vals.min, vals.max
    hi = lo + 1 if hi == lo
    xy = points.each_with_index.map { |(_, v), i|
      [pad + i * (w - 2 * pad) / [points.size - 1, 1].max, pad + (hi - v) * (hgt - 2 * pad) / (hi - lo)]
    }
    line = xy.map { |x, y| format("%.1f,%.1f", x, y) }.join(" ")
    lx, ly = xy.last
    %(<svg class="spark" viewBox="0 0 #{w.to_i} #{hgt.to_i}" role="img" aria-label="#{CGI.escapeHTML(label)}"><polyline points="#{line}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><circle cx="#{format("%.1f", lx)}" cy="#{format("%.1f", ly)}" r="3.5" fill="currentColor"/></svg>)
  end

  def tile(kind, segment)
    d = data(kind) or return nil
    pts = d["series"][segment] or return nil
    return nil if pts.size < 5
    last12 = pts.last(12)
    k, v = pts.last
    qoq = pct(v, pts[-2][1]); yoy = pct(v, pts[-5][1])
    name = kind == "rental" ? "Rental index" : "Price index"
    seg = segment == "All Industrial" ? "All industrial" : segment.sub("Multiple-User Factory", "Multiple-user factory").sub("Single-User Factory", "Single-user factory")
    label = "#{name}, #{seg}: #{last12.first[0]} to #{k}, from #{last12.first[1]} to #{v}"
    <<~T
      <div class="jtc-tile">
        <p class="eyebrow">#{name} · #{CGI.escapeHTML(seg)}</p>
        <p class="jtc-val">#{format("%.1f", v)} <span>#{k}</span></p>
        #{spark(last12, label)}
        <p class="jtc-chg"><span>#{fmt_pct(qoq)} <small>on the quarter</small></span><span>#{fmt_pct(yoy)} <small>on the year</small></span></p>
      </div>
    T
  end

  def source_note
    r = data("rental"); p = data("price")
    upd = [r, p].compact.map { |d| d["updated"] }.compact.first
    %(<p class="calc-note">Index, 4th quarter 2012 = 100. Source: JTC, via <a href="https://tablebuilder.singstat.gov.sg/table/TS/M212171" rel="noopener">SingStat Table Builder</a> (tables M212171 and M212181)#{upd ? ", updated #{CGI.escapeHTML(upd)}" : ""}. Market-wide figures, not a valuation of any unit.</p>)
  end

  # Block for one listing: rental index for its segment, and the all-industrial price index
  def listing_block(listing)
    tiles = [tile("rental", segment_for(listing)), tile("price", "All Industrial")].compact
    return "" if tiles.empty?
    <<~B
      <h2 class="hd" id="numbers-h">Industrial rents and prices <em>across Singapore</em></h2>
      <div class="jtc-grid">
      #{tiles.join}
      </div>
      #{source_note}
    B
  end

  # Section for the Industrial page: every segment
  def market_section
    tiles = ["All Industrial", "Multiple-User Factory", "Warehouse", "Business Park", "Single-User Factory"].map { |s| tile("rental", s) } +
            ["All Industrial", "Multiple-User Factory", "Single-User Factory"].map { |s| tile("price", s) }
    tiles.compact!
    return "" if tiles.empty?
    <<~S
      <section class="sec" id="market" aria-labelledby="market-h" style="padding-top:0">
        <div class="wrap">
          <div class="sec-head">
            <h2 class="hd" id="market-h">Industrial market <em>at a glance</em></h2>
            <p class="desc">JTC indices, last 12 quarters</p>
          </div>
          <div class="jtc-grid">
          #{tiles.join}
          </div>
          #{source_note}
        </div>
      </section>
    S
  end
end
