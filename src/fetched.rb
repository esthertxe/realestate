# encoding: UTF-8
# When each cached dataset in data/ was last downloaded. Kept in data/fetched.json (not file dates, which reset
# when GitHub checks the repository out), so refreshes happen on schedule on the Mac and on the GitHub job alike.
require "json"
require "time"

module Fetched
  module_function

  FILE = "data/fetched.json"

  def all
    File.exist?(FILE) ? JSON.parse(File.read(FILE)) : {}
  end

  def fresh?(path, days)
    t = all[path]
    File.exist?(path) && t && Time.now - Time.parse(t) < days * 86_400
  end

  def mark(path)
    a = all
    a[path] = Time.now.utc.iso8601
    Dir.mkdir("data") unless Dir.exist?("data")
    File.write(FILE, JSON.pretty_generate(a.sort.to_h) + "\n")
  end
end
