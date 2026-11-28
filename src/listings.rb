# encoding: UTF-8
# Listing pages, built from listings/<slug>.json by build.sh.
#   - writes /<type>/<slug>.html for each listing (type: residential, industrial or commercial)
#   - gives the listing cards that build.sh puts into the For sale / For lease columns of the type pages
#   - rewrites sitemap.xml with the listing pages added
# Photos: put the originals in assets/listings/<slug>/ (kept local); build.sh resizes them into img/listings/<slug>/.
# Files whose name starts with "_" (e.g. listings/_sample.json) are previews: built only with PREVIEW=1, never published.
require "json"
require "cgi"
require "date"
require "fileutils"

module Listings
  SITE = "https://www.esthertxe.com"
  PHONE = "+6588008787"
  TYPES = { "residential" => "Residential", "industrial" => "Industrial", "commercial" => "Commercial" }
  STATUS = { "available" => "Available", "under-offer" => "Under offer", "sold" => "Sold", "let" => "Let" }
  ARROW = "→"

  module_function

  def h(s) CGI.escapeHTML(s.to_s) end
  def enc(s) s.to_s.gsub(/[^A-Za-z0-9\-_.~]/) { |c| c.bytes.map { |b| "%%%02X" % b }.join } end
  def num(n) n.to_i.to_s.reverse.scan(/\d{1,3}/).join(",").reverse end
  def money(n) "S$" + num(n) end
  def lease?(l) l["deal"] == "lease" end

  # assets/listings/<slug>/<any photos> -> img/listings/<slug>/01.jpg, 02.jpg ... (longest side 1600px), in file-name order
  def resize_photos
    Dir.glob("assets/listings/*/").sort.each do |dir|
      slug = File.basename(dir)
      out = "img/listings/#{slug}"
      srcs = Dir.glob(File.join(dir, "*")).select { |f| f =~ /\.(jpe?g|png|heic|webp)\z/i }.sort
      next if srcs.empty?
      FileUtils.mkdir_p(out)
      srcs.each_with_index do |src, i|
        dst = format("%s/%02d.jpg", out, i + 1)
        next if File.exist?(dst) && File.mtime(dst) >= File.mtime(src)
        system("sips", "-Z", "1600", "-s", "format", "jpeg", "-s", "formatOptions", "80", src, "--out", dst, out: File::NULL) or abort "sips failed on #{src}"
      end
      Dir.glob("#{out}/*.jpg").each { |f| File.delete(f) if File.basename(f, ".jpg").to_i > srcs.size }
    end
  end

  def load(preview)
    Dir.glob("listings/*.json").sort.map { |f|
      next if File.basename(f).start_with?("_") && !preview
      l = JSON.parse(File.read(f, encoding: "UTF-8"))
      l["slug"] ||= File.basename(f, ".json")
      abort "#{f}: type must be residential, industrial or commercial" unless TYPES[l["type"]]
      abort "#{f}: deal must be sale or lease" unless %w[sale lease].include?(l["deal"])
      l["status"] ||= "available"
      l["photos"] = Dir.glob("img/listings/#{l["slug"]}/*.jpg").sort.each_with_index.map { |p, i|
        d = `sips -g pixelWidth -g pixelHeight "#{p}"`
        { "src" => "/" + p, "w" => d[/pixelWidth: (\d+)/, 1], "h" => d[/pixelHeight: (\d+)/, 1],
          "alt" => (l["photo_alts"] || [])[i] || "Photo #{i + 1} of #{l["name"]}" }
      }
      l
    }.compact
  end

  def path(l) "/#{l["type"]}/#{l["slug"]}.html" end
  def price_text(l) lease?(l) ? "#{money(l["price"])} / month" : money(l["price"]) end
  def psf(l) (!lease?(l) && l["size_sqft"].to_i > 0) ? "S$#{num((l["price"].to_f / l["size_sqft"].to_f).round)} psf" : nil end

  def meta_line(l)
    [l["subtype"], (l["size_sqft"] ? "#{num(l["size_sqft"])} sq ft" : nil),
     (l["bedrooms"] ? "#{l["bedrooms"]} bed" : nil), l["district"]].compact.join(" · ")
  end

  def card(l)
    img = if (p = l["photos"].first)
      %(<img src="#{p["src"]}" width="#{p["w"]}" height="#{p["h"]}" alt="#{h(p["alt"])}" loading="lazy">)
    else
      %(<span class="listing-ph" aria-hidden="true">Photos on request</span>)
    end
    badge = l["status"] == "available" ? "" : %(<span class="listing-badge">#{STATUS[l["status"]]}</span>)
    <<~C
      <article class="listing">
        <a class="listing-img" href="#{path(l)}" tabindex="-1">#{img}#{badge}</a>
        <div class="listing-body">
          <p class="listing-price">#{h(price_text(l))}</p>
          <h4><a href="#{path(l)}">#{h(l["name"])}</a></h4>
          <p class="listing-meta">#{h(meta_line(l))}</p>
        </div>
      </article>
    C
  end

  # Cards for one column of a type page; available listings first.
  def cards_for(all, type, deal)
    all.select { |l| l["type"] == type && l["deal"] == deal }
       .sort_by { |l| [l["status"] == "available" ? 0 : 1, l["name"]] }
       .map { |l| card(l) }.join
  end

  def facts(l)
    rows = []
    rows << [lease?(l) ? "Rent" : "Asking price", price_text(l)]
    rows << ["Price per sq ft", psf(l)] if psf(l)
    rows << ["Property type", l["subtype"]]
    rows << ["Size", "#{num(l["size_sqft"])} sq ft"] if l["size_sqft"]
    rows << ["Bedrooms", l["bedrooms"]]
    rows << ["Bathrooms", l["bathrooms"]]
    rows << ["Tenure", l["tenure"]]
    rows << ["Completed (TOP)", l["top"]]
    rows << ["Furnishing", l["furnishing"]]
    rows << ["Lease term", l["lease_months"] ? "#{l["lease_months"]} months" : nil] if lease?(l)
    rows << ["Available from", l["available"]]
    rows << ["District", l["district"]]
    rows << ["Nearest MRT", l["mrt"]]
    rows.reject { |_, v| v.nil? || v.to_s.strip.empty? }
  end

  # Move-in costs for a lease (IRAS lease stamp duty checked 28 Nov 2026: 0.4% of total rent for up to 4 years,
  # 0.4% of 4 x average annual rent above 4 years, exempt if annual rent is S$1,000 or less, rounded down, minimum S$1).
  def move_in(l)
    r = l["price"].to_i; m = l["lease_months"].to_i
    return nil unless lease?(l) && r > 0 && m > 0
    dep_m = l["deposit_months"] || [1, (m / 12.0).round].max
    duty = if r * 12 <= 1000 then 0
           else [((m <= 48 ? r * m : r * 12 * 4) * 0.004).floor, 1].max end
    rows = [["First month's rent, paid in advance", money(r)],
            ["Security deposit (#{dep_m == 1 ? "1 month's" : "#{dep_m} months'"} rent)", money(r * dep_m)],
            ["Stamp duty on the tenancy agreement", duty.zero? ? "Exempt" : money(duty)]]
    [rows, money(r + r * dep_m + duty)]
  end

  def faqs(l)
    q = []
    if lease?(l)
      q << ["What is the rent for #{l["name"]}?", "#{price_text(l)}#{l["lease_months"] ? ", for a lease of #{l["lease_months"]} months" : ""}."]
    else
      q << ["What is the asking price of #{l["name"]}?", money(l["price"]) + (psf(l) ? ", or #{psf(l)} on #{num(l["size_sqft"])} sq ft." : ".")]
    end
    where = [l["address"], l["district"]].compact.join(", ")
    q << ["Where is #{l["name"]}?", where + (l["mrt"] ? ". Nearest MRT: #{l["mrt"]}." : ".")] unless where.empty?
    q << ["When is it available?", "#{l["available"]}."] if l["available"]
    q << ["What is the tenure?", "#{l["tenure"]}."] if l["tenure"] && !lease?(l)
    (l["faq"] || []).each { |qa| q << qa }
    q << ["How do I arrange a viewing?", "Message Esther on WhatsApp or call +65 8800 8787 to arrange a viewing."]
    q << ["How can I check Esther's registration?", "Search R060284E on the Council for Estate Agencies (CEA) public register at www.cea.gov.sg."]
    q
  end

  def json_ld(l)
    url = SITE + path(l)
    status_avail = l["status"] == "available" ? "https://schema.org/InStock" : "https://schema.org/SoldOut"
    listing = {
      "@type" => "RealEstateListing", "@id" => url + "#listing", "url" => url, "name" => l["name"],
      "description" => l["summary"] || meta_line(l), "datePosted" => l["listed"] || l["updated"],
      "dateModified" => l["updated"], "inLanguage" => "en-SG",
      "image" => l["photos"].map { |p| SITE + p["src"] },
      "offers" => { "@type" => "Offer", "price" => l["price"].to_i, "priceCurrency" => "SGD", "availability" => status_avail,
                    "businessFunction" => lease?(l) ? "http://purl.org/goodrelations/v1#LeaseOut" : "http://purl.org/goodrelations/v1#Sell",
                    "offeredBy" => { "@id" => SITE + "/#esther-txe" } },
      "contentLocation" => { "@type" => "Place", "name" => l["name"],
                             "address" => { "@type" => "PostalAddress", "streetAddress" => l["address"], "postalCode" => l["postal_code"], "addressCountry" => "SG" }.compact },
      "breadcrumb" => { "@id" => url + "#breadcrumb" }
    }
    listing.delete("image") if listing["image"].empty?
    crumbs = { "@type" => "BreadcrumbList", "@id" => url + "#breadcrumb", "itemListElement" => [
      { "@type" => "ListItem", "position" => 1, "name" => "Home", "item" => SITE + "/" },
      { "@type" => "ListItem", "position" => 2, "name" => TYPES[l["type"]], "item" => "#{SITE}/#{l["type"]}.html" },
      { "@type" => "ListItem", "position" => 3, "name" => l["name"], "item" => url }] }
    faq = { "@type" => "FAQPage", "@id" => url + "#faq", "mainEntity" => faqs(l).map { |qq, a|
      { "@type" => "Question", "name" => qq, "acceptedAnswer" => { "@type" => "Answer", "text" => a } } } }
    JSON.pretty_generate({ "@context" => "https://schema.org", "@graph" => [listing, crumbs, faq] })
  end

  def page(l, all, shell)
    type_name = TYPES[l["type"]]
    deal_word = lease?(l) ? "For lease" : "For sale"
    url = SITE + path(l)
    title = "#{l["name"]}, #{l["subtype"]} #{deal_word.downcase}, #{price_text(l)} | Esther Txe"
    desc = l["summary"] || "#{l["subtype"]} #{deal_word.downcase} at #{l["address"]}: #{price_text(l)}. #{meta_line(l)}. Esther Txe, CEA R060284E."
    wa = "https://wa.me/6588008787?text=" + enc("Hi Esther, is #{l["name"]} (#{l["address"]}) #{lease?(l) ? "for lease" : "for sale"} at #{price_text(l)} still available?")
    maps = "https://www.google.com/maps/search/?api=1&query=" + enc([l["name"], l["address"], "Singapore"].compact.join(", "))
    og_img = l["photos"].first ? SITE + l["photos"].first["src"] : SITE + "/og-image.jpg"

    gallery = if l["photos"].empty?
      %(<div class="gallery-empty"><p>Photos are available on request.</p></div>)
    else
      shown = l["photos"].first(5)
      more = l["photos"].size - shown.size
      items = shown.each_with_index.map { |p, i|
        extra = (i == shown.size - 1 && more > 0) ? %(<span class="gallery-more">+#{more} photos</span>) : ""
        %(<a href="#{p["src"]}" target="_blank" rel="noopener"><img src="#{p["src"]}" width="#{p["w"]}" height="#{p["h"]}" alt="#{h(p["alt"])}"#{i.zero? ? "" : ' loading="lazy"'}>#{extra}</a>)
      }.join("\n          ")
      all_links = l["photos"].size > 5 ? %(<p class="gallery-all">#{l["photos"].each_with_index.map { |p, i| %(<a href="#{p["src"]}" target="_blank" rel="noopener">Photo #{i + 1}</a>) }.join(" ")}</p>) : ""
      %(<div class="gallery gallery-#{[shown.size, 5].min}">\n          #{items}\n        </div>#{all_links})
    end

    fact_rows = facts(l).map { |k, v| %(<div><dt>#{h(k)}</dt><dd>#{h(v)}</dd></div>) }.join("\n            ")
    highlights = (l["highlights"] || []).map { |x| "<li>#{h(x)}</li>" }.join
    desc_html = (l["description"] || []).map { |p| "<p>#{h(p)}</p>" }.join("\n          ")
    facilities = (l["facilities"] || []).map { |x| "<li>#{h(x)}</li>" }.join

    numbers = if lease?(l)
      mi = move_in(l)
      if mi
        rows, total = mi
        <<~N
          <h2 class="hd" id="numbers-h">Cost to <em>move in</em></h2>
          <table class="res" id="movein-table">
            #{rows.map { |k, v| %(<tr><th scope="row">#{h(k)}</th><td>#{v}</td></tr>) }.join("\n    ")}
            <tr class="total"><th scope="row">Total before you move in</th><td>#{total}</td></tr>
          </table>
          <p class="calc-note">Estimate only. The deposit and advance rent are agreed with the landlord in the letter of intent. Stamp duty is 0.4% of the total rent for a lease of up to 4 years (<a href="https://www.iras.gov.sg/taxes/stamp-duty/for-property/renting-a-property" rel="noopener">IRAS</a>, checked 28 November 2026).</p>
        N
      else ""
      end
    else
      t = l["type"] == "residential" ? "res" : "non"
      q = "?price=#{l["price"].to_i}&type=#{t}" + (l["expected_rent"] ? "&rent=#{l["expected_rent"].to_i}" : "")
      <<~N
        <h2 class="hd" id="numbers-h">Run the numbers <em>for this property</em></h2>
        <ul class="calc-list">
          <li><a href="/calculators.html#{q}#stamp-duty"><strong>Stamp duty at this price</strong><span>#{l["type"] == "residential" ? "BSD and ABSD for your buyer profile" : "Buyer's Stamp Duty on commercial and industrial property"}</span><i aria-hidden="true">#{ARROW}</i></a></li>
          <li><a href="/calculators.html#{q}#borrow"><strong>How much I can borrow</strong><span>Check your loan against this price</span><i aria-hidden="true">#{ARROW}</i></a></li>
          <li><a href="/calculators.html#{q}#cashflow"><strong>Rental cashflow &amp; yield</strong><span>If you plan to rent it out#{l["expected_rent"] ? ", at " + money(l["expected_rent"]) + " a month" : ""}</span><i aria-hidden="true">#{ARROW}</i></a></li>
        </ul>
      N
    end

    faq_html = faqs(l).map { |qq, a|
      %(<details><summary>#{h(qq)}<span class="ico" aria-hidden="true"><svg viewBox="0 0 14 14"><path d="M7 2v10M2.5 7.5 7 12l4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg></span></summary><p>#{h(a)}</p></details>)
    }.join("\n          ")

    similar = all.reject { |o| o["slug"] == l["slug"] }.select { |o| o["type"] == l["type"] && o["deal"] == l["deal"] && o["status"] == "available" }.first(3)
    similar_html = similar.empty? ?
      %(<p class="listing-none">Looking for something similar? <a href="/#{l["type"]}.html">See #{type_name.downcase} property</a> or ask me for current options.</p>) :
      %(<div class="listing-grid">#{similar.map { |o| card(o) }.join}</div>)

    status_chip = l["status"] == "available" ? "" : %(<span class="status-chip">#{STATUS[l["status"]]}</span>)

    <<~HTML
      <!doctype html>
      <html lang="en">
      <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
      <title>#{h(title)}</title>
      <meta name="description" content="#{h(desc)}">
      <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
      <meta name="author" content="Esther Txe">
      <link rel="canonical" href="#{url}">
      <meta name="geo.region" content="SG">
      <meta name="geo.placename" content="Singapore">
      <meta name="color-scheme" content="light dark">
      <meta name="theme-color" content="#2c2b27">
      <meta property="og:type" content="website">
      <meta property="og:url" content="#{url}">
      <meta property="og:site_name" content="Esther Txe, Property Advisor">
      <meta property="og:locale" content="en_SG">
      <meta property="og:title" content="#{h(title)}">
      <meta property="og:description" content="#{h(desc)}">
      <meta property="og:image" content="#{og_img}">
      <meta name="twitter:card" content="summary_large_image">
      <meta name="twitter:title" content="#{h(title)}">
      <meta name="twitter:description" content="#{h(desc)}">
      <meta name="twitter:image" content="#{og_img}">
      <script type="application/ld+json">
      #{json_ld(l)}
      </script>
      #{shell[:fonts]}
      <style>
      #{shell[:css]}
      </style>
      </head>
      <body class="has-bar">
      <a class="skip" href="#main">Skip to content</a>

      <header class="page-head on-dark">
        <div class="page-head-in">
          <nav class="nav" aria-label="Main">
            <a class="brand" href="/">Esther Txe</a>
      <ul class="nav-links">
        <li><a href="/#start">Start here</a></li>
        <li><a href="/#properties" aria-current="page">Properties</a></li>
        <li><a href="/calculators.html">Calculators</a></li>
        <li><a href="/#services">Services</a></li>
        <li><a href="/#process">Process</a></li>
        <li><a href="/#faq">FAQ</a></li>
        <li><a href="#contact">Contact</a></li>
      </ul>
            <div class="nav-meta">
              <a class="phone" href="tel:#{PHONE}">+65 8800 8787</a>
              <span>Based in Singapore</span>
            </div>
            <a class="btn btn-white" href="#{wa}" rel="noopener">WhatsApp</a>
          </nav>
          <div class="page-title listing-title" data-listing="#{h(l["slug"])}">
            <p class="crumbs"><a href="/">Home</a> <span aria-hidden="true">/</span> <a href="/#{l["type"]}.html">#{type_name}</a> <span aria-hidden="true">/</span> #{h(l["name"])}</p>
            <p class="listing-chips"><span class="status-chip on">#{deal_word}</span>#{status_chip}</p>
            <h1>#{h(l["name"])} <em>#{h(l["subtype"])}</em></h1>
            <p class="page-lead">#{h([l["address"], l["postal_code"] ? "Singapore #{l["postal_code"]}" : nil].compact.join(", "))}</p>
            <p class="listing-hero-price"><span id="l-price">#{h(price_text(l))}</span>#{psf(l) ? %(<span class="psf">#{psf(l)}</span>) : ""}</p>
          </div>
        </div>
      </header>

      <main id="main" tabindex="-1">

        <section class="sec gallery-sec" aria-label="Photos">
          <div class="wrap">
            #{gallery}
          </div>
        </section>

        <section class="sec" aria-labelledby="details-h" style="padding-top:0">
          <div class="wrap listing-main">
            <div>
              #{highlights.empty? ? "" : %(<h2 class="eyebrow">Highlights</h2><ul class="highlights">#{highlights}</ul>)}
              <h2 class="hd" id="details-h">About <em>this property</em></h2>
              <div class="listing-desc">
                #{desc_html}
              </div>
              #{facilities.empty? ? "" : %(<h3 class="eyebrow">Facilities</h3><ul class="chips">#{facilities}</ul>)}
            </div>
            <aside class="facts-card" aria-label="Key details">
              <h2 class="eyebrow">Key details</h2>
              <dl class="facts" id="facts">
                #{fact_rows}
              </dl>
              <div class="facts-actions">
                <a class="btn btn-olive" href="#{wa}" rel="noopener">WhatsApp Esther</a>
                <a class="btn btn-outline" href="tel:#{PHONE}">Call</a>
                <a class="btn btn-outline" href="#{maps}" rel="noopener">Open in Google Maps</a>
                <button class="btn btn-outline pdf-btn" type="button" data-pdf="listing" aria-describedby="pdf-hint-listing">Fact sheet (PDF)</button>
              </div>
              <p class="pdf-hint" id="pdf-hint-listing" aria-live="polite">Details as at #{h(Date.parse(l["updated"]).strftime("%-d %B %Y"))}.</p>
            </aside>
          </div>
        </section>

        #{numbers.empty? ? "" : %(<section class="sec" id="numbers" aria-labelledby="numbers-h" style="padding-top:0"><div class="wrap listing-numbers">\n#{numbers}</div></section>)}

        <section class="sec" aria-labelledby="lfaq-h" style="padding-top:0">
          <div class="wrap">
            <div class="sec-head">
              <h2 class="hd" id="lfaq-h">Questions <em>about this property</em></h2>
              <p class="desc">#{h(l["name"])}</p>
            </div>
            <div class="acc listing-faq">
              #{faq_html}
            </div>
          </div>
        </section>

        <section class="sec" aria-labelledby="similar-h" style="padding-top:0">
          <div class="wrap">
            <div class="sec-head">
              <h2 class="hd" id="similar-h">Similar <em>#{lease?(l) ? "for lease" : "for sale"}</em></h2>
              <p class="desc">#{type_name}</p>
            </div>
            #{similar_html}
          </div>
        </section>

        <section class="sec contact calc-help" id="contact" aria-labelledby="help-h">
          <div class="wrap calc-help-in">
            <h2 class="hd" id="help-h">Interested in <em>#{h(l["name"])}?</em></h2>
            <div>
              <p>Message me to arrange a viewing, ask about the terms, or go through the numbers before you commit.</p>
              <p class="calc-help-btns"><a class="btn btn-white" href="#{wa}" rel="noopener">Chat on WhatsApp</a> <a class="btn btn-outline" href="tel:#{PHONE}">Call +65 8800 8787</a></p>
            </div>
          </div>
        </section>

      </main>

      #{shell[:footer].sub("</div>\n</footer>", %(  <p>Listing details as at #{h(Date.parse(l["updated"]).strftime("%-d %B %Y"))}. Photos and details are for reference only; please check them before you commit.</p>\n  </div>\n</footer>))}

      <div class="listing-bar" role="region" aria-label="Contact about this listing">
        <p><strong>#{h(price_text(l))}</strong> <span>#{h(l["name"])}</span></p>
        <a class="btn btn-white" href="#{wa}" rel="noopener">WhatsApp</a>
        <a class="btn btn-outline" href="tel:#{PHONE}">Call</a>
      </div>

      <div id="print-report" aria-hidden="true"></div>

      <script>
      #{shell[:js]}
      </script>
      </body>
      </html>
    HTML
  end

  # Build every listing page and the sitemap. Returns the listings.
  def build(preview)
    all = load(preview)
    calc = File.read("src/calculators.src.html", encoding: "UTF-8")
    shell = {
      fonts: calc[/<link rel="preconnect".*?rel="stylesheet">/m],
      footer: calc[/<footer class="foot">.*?<\/footer>/m],
      css: File.read("src/styles.css", encoding: "UTF-8"),
      js: File.read("src/site.js", encoding: "UTF-8")
    }
    # Remove pages of listings that no longer exist
    TYPES.keys.each do |t|
      Dir.glob("#{t}/*.html").each { |f| File.delete(f) unless all.any? { |l| path(l) == "/" + f } }
    end
    all.each do |l|
      Dir.mkdir(l["type"]) unless Dir.exist?(l["type"])
      File.write(path(l)[1..-1], page(l, all, shell))
      puts "#{path(l)[1..-1]}"
    end
    write_sitemap(all.reject { |l| l["slug"].start_with?("_") })
    all
  end

  def write_sitemap(listings)
    old = File.exist?("sitemap.xml") ? File.read("sitemap.xml", encoding: "UTF-8") : ""
    pages = old.scan(%r{<url>\s*<loc>([^<]+)</loc>\s*<lastmod>([^<]+)</lastmod>\s*</url>}).reject { |u, _| u =~ %r{\.com/(residential|industrial|commercial)/} }
    pages += listings.map { |l| [SITE + path(l), l["updated"]] }
    xml = %(<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n)
    pages.each { |u, d| xml << "  <url>\n    <loc>#{u}</loc>\n    <lastmod>#{d}</lastmod>\n  </url>\n" }
    xml << "</urlset>\n"
    File.write("sitemap.xml", xml)
  end
end
