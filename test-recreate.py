import urllib.request, json

req = urllib.request.Request(
    'https://practice-ledger.onrender.com/api/auth/login',
    data=json.dumps({'username': 'admin', 'password': 'Zz741852'}).encode('utf-8'),
    headers={'Content-Type': 'application/json'},
    method='POST'
)
resp = urllib.request.urlopen(req, timeout=60)
token = json.loads(resp.read().decode('utf-8'))['token']

req = urllib.request.Request(
    'https://practice-ledger.onrender.com/api/records',
    headers={'Authorization': 'Bearer ' + token}
)
resp = urllib.request.urlopen(req, timeout=60)
records = json.loads(resp.read().decode('utf-8'))['records']
for r in records:
    if r['name'] == '持久化测试':
        req = urllib.request.Request(
            f'https://practice-ledger.onrender.com/api/records/{r["id"]}',
            headers={'Authorization': 'Bearer ' + token},
            method='DELETE'
        )
        urllib.request.urlopen(req, timeout=60)
        print(f'已删除测试记录: {r["name"]}')

records_to_add = [
    {'name':'李嘉倩','mentor':'乾书玉','dept1':'自营','dept2':'',
     'startDate':'2026-08-03','practiceDays':7,'deviceModel':'','serialNumber':'','accessories':'','remark':''},
    {'name':'王磊','mentor':'谭云松','dept1':'自营','dept2':'',
     'startDate':'2026-08-03','practiceDays':15,'deviceModel':'','serialNumber':'','accessories':'','remark':''},
    {'name':'杨佳','mentor':'邓龙翔','dept1':'自营','dept2':'自营D组',
     'startDate':'2026-07-27','practiceDays':5,'deviceModel':'','serialNumber':'','accessories':'','remark':''}
]
for r in records_to_add:
    req = urllib.request.Request(
        'https://practice-ledger.onrender.com/api/records',
        data=json.dumps(r, ensure_ascii=False).encode('utf-8'),
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json; charset=utf-8'},
        method='POST'
    )
    resp = urllib.request.urlopen(req, timeout=60)
    result = json.loads(resp.read().decode('utf-8'))
    rec = result.get('record', {})
    warning = result.get('warning', '')
    print(f'创建: {rec.get("name")} | {rec.get("startDate")}~{rec.get("endDate")} ({rec.get("practiceDays")}天) | {rec.get("status")}{" | ⚠" + warning if warning else ""}')

print()
req = urllib.request.Request(
    'https://practice-ledger.onrender.com/api/records',
    headers={'Authorization': 'Bearer ' + token}
)
resp = urllib.request.urlopen(req, timeout=60)
records = json.loads(resp.read().decode('utf-8'))['records']
print(f'最终记录数: {len(records)}')
for r in records:
    print(f'  - {r["name"]} / 带教:{r["mentor"]} / {r["startDate"]}~{r["endDate"]}')