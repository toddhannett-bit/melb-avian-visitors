import json, urllib.request, os, re, collections
URL="https://app.birdweather.com/graphql"
S=["30108","16110","10847","19263","26279","30491"]
def q(qs,v=None):
    b=json.dumps({"query":qs,"variables":v or {}}).encode()
    r=urllib.request.Request(URL,b,{"Content-Type":"application/json"})
    return json.loads(urllib.request.urlopen(r).read().decode())

d=q('''query($ids:[ID!]){ topSpecies(period:{count:90,unit:"day"}, stationIds:$ids, limit:300){
       count species{ commonName scientificName } } }''',{"ids":S})["data"]["topSpecies"]
slug=lambda s: re.sub(r'[^a-z]+','-',s.lower()).strip('-')
# A checkout of upstream AvianVisitors, for comparing art coverage.
# Override with ILLUSTRATIONS=/path/to/avian/assets/illustrations
ill=os.environ.get('ILLUSTRATIONS','../AvianVisitors/avian/assets/illustrations')
if not os.path.isdir(ill):
    raise SystemExit(f'No illustrations at {ill!r}. Set ILLUSTRATIONS= to an AvianVisitors checkout.')
have=set(re.sub(r'-(perched|flight|flying)$','',os.path.splitext(f)[0]) for f in os.listdir(ill))
cov=[r for r in d if slug(r['species']['scientificName']) in have]
print(f"5km cluster, 90 days: {len(d)} species")
print(f"  already illustrated upstream: {len(cov)} -> {[r['species']['commonName'] for r in cov]}")
print(f"  need generating (pre-filter) : {len(d)-len(cov)}")

# The nearest station on its own, for comparison with the cluster
w=q('''query{ topSpecies(period:{count:90,unit:"day"}, stationIds:["30108"], limit:300){
       count species{ commonName } } }''')["data"]["topSpecies"]
print(f"\nNearest station alone, 90 days: {len(w)} species")
print("  ", ", ".join(r['species']['commonName'] for r in w[:20]))

# time of day for the dawn chorus feature
t=q('''query($ids:[ID!]){ timeOfDayDetectionCounts(period:{count:30,unit:"day"}, stationIds:$ids){
       hour count } }''',{"ids":S})["data"]["timeOfDayDetectionCounts"]
print("\nDetections by hour of day (30d, Australia/Melbourne):")
mx=max(x['count'] for x in t)
for x in sorted(t,key=lambda h:h['hour']):
    bar="#"*int(46*x['count']/mx)
    print(f"  {x['hour']:>2}:00 {x['count']:>6,} {bar}")
