import json, urllib.request, collections
URL="https://app.birdweather.com/graphql"
S=["30108","16110","10847","19263","26279","30491"]
def q(qs,v=None):
    b=json.dumps({"query":qs,"variables":v or {}}).encode()
    r=urllib.request.Request(URL,b,{"Content-Type":"application/json"})
    return json.loads(urllib.request.urlopen(r).read().decode())

# pull a large sample of raw detections with score, 30d, 5km cluster
Q='''query($ids:[ID!],$after:String){
  detections(period:{count:30,unit:"day"}, stationIds:$ids, first:500, after:$after){
    pageInfo{ hasNextPage endCursor }
    nodes{ confidence score species{ commonName } } } }'''
rows=[]; after=None
for _ in range(24):                      # up to 12k detections
    d=q(Q,{"ids":S,"after":after})["data"]["detections"]
    rows += [(n["species"]["commonName"], n["confidence"], n["score"]) for n in d["nodes"]]
    if not d["pageInfo"]["hasNextPage"]: break
    after=d["pageInfo"]["endCursor"]
print(f"sampled {len(rows)} detections\n")

def survivors(rows, key, thr):
    sp=collections.Counter(n for n,c,s in rows if (c if key=='conf' else s) >= thr)
    return sp

allsp=collections.Counter(n for n,_,_ in rows)
junk={"Glossy Black-Cockatoo","Whiskered Tern","Osprey","Caspian Tern","Great Egret"}
real={"Laughing Kookaburra","Musk Lorikeet","Long-billed Corella","Galah","Silvereye",
      "Common Bronzewing","White-plumed Honeyeater","Black-faced Cuckooshrike"}
print(f"{'gate':<14} {'species kept':>12} {'implausible kept':>17} {'real-rare kept':>15} {'detections kept':>16}")
print("-"*80)
for key,thr in [('conf',0.0),('conf',0.75),('conf',0.85),('conf',0.90),
                ('score',4.0),('score',5.0),('score',6.0),('score',6.5),('score',7.0)]:
    s=survivors(rows,key,thr)
    kept=sum(s.values())
    print(f"{key} >= {thr:<7} {len(s):>12} {len(junk&set(s)):>17} {len(real&set(s)):>15} {100*kept/len(rows):>15.1f}%")

print("\n--- score profile, all sampled species (n>=1) ---")
prof=collections.defaultdict(list)
for n,c,s in rows: prof[n].append(s)
for n in sorted(prof, key=lambda k:-max(prof[k])):
    v=prof[n]; mark="!" if n in junk else ("*" if n in real else " ")
    print(f" {mark} {n:<30} n={len(v):>6}  score max={max(v):5.2f} mean={sum(v)/len(v):5.2f}")
