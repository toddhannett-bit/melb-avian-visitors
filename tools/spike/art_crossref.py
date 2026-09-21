import json, urllib.request, re
URL="https://app.birdweather.com/graphql"
S=["30108","16110","10847","19263","26279","30491"]
def q(qs,v=None):
    b=json.dumps({"query":qs,"variables":v or {}}).encode()
    r=urllib.request.Request(URL,b,{"Content-Type":"application/json"})
    return json.loads(urllib.request.urlopen(r).read().decode())

# resolve Upper Brookfield's scientific slugs -> common names via BirdWeather taxonomy
ub_slugs=open('ub_species.txt').read().split()
ub_common=set()
for sl in ub_slugs:
    sci=" ".join(w.capitalize() if i==0 else w for i,w in enumerate(sl.split("-")))
    r=q('query($s:String!){ searchSpecies(query:$s, first:1){ nodes{ commonName scientificName } } }',{"s":sci})
    n=r.get("data",{}).get("searchSpecies",{}).get("nodes") or []
    if n: ub_common.add(n[0]["commonName"])
print(f"Upper Brookfield: {len(ub_slugs)} species, {len(ub_common)} resolved\n")

fug={"Rainbow Lorikeet","Rose Robin","Laughing Kookaburra","Magpie-lark","Superb Fairywren",
"Yellow-faced Honeyeater","Crimson Rosella","Brown Thornbill","Olive-backed Oriole",
"Little Wattlebird","Australian Magpie","Sulphur-crested Cockatoo","Galah","Noisy Miner",
"Common Myna","Australian Ibis","Crested Pigeon","Red Wattlebird","Tawny Frogmouth",
"Yellow-tailed Black-Cockatoo"}

av=q('''query($ids:[ID!]){ topSpecies(period:{count:90,unit:"day"}, stationIds:$ids, limit:300){
     count species{ commonName } } }''',{"ids":S})["data"]["topSpecies"]
tot=sum(r['count'] for r in av); run=0
print(f"{'#':>3} {'species':<28} {'cum%':>6}  {'UpperBrookfield':^15} {'Gould/Fugleramme':^17}")
print("-"*76)
for i,r in enumerate(av[:16],1):
    cn=r['species']['commonName']; run+=r['count']
    print(f"{i:>3} {cn:<28} {100*run/tot:>5.1f}%  {('YES' if cn in ub_common else '-'):^15} {('YES' if cn in fug else '-'):^17}")
allcn={r['species']['commonName'] for r in av}
both=ub_common|fug
print(f"\nCluster 90d species: {len(av)}")
print(f"  Upper Brookfield covers : {len(allcn & ub_common)}")
print(f"  Gould/Fugleramme covers : {len(allcn & fug)}")
print(f"  EITHER                  : {len(allcn & both)}")
top8={r['species']['commonName'] for r in av[:8]}
print(f"  of the top 8 (95% of detections): {len(top8 & both)}/8 covered")
print(f"  GAPS in top 8: {sorted(top8 - both)}")
print(f"  GAPS in top 16: {[r['species']['commonName'] for r in av[:16] if r['species']['commonName'] not in both]}")
