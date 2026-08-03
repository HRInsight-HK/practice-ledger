import urllib.request, json

# 登录
req = urllib.request.Request(
    'https://practice-ledger.onrender.com/api/auth/login',
    data=json.dumps({'username': 'admin', 'password': 'Zz741852'}).encode('utf-8'),
    headers={'Content-Type': 'application/json'},
    method='POST'
)
resp = urllib.request.urlopen(req, timeout=60)
token = json.loads(resp.read().decode('utf-8'))['token']
print('登录成功')

# 创建3条记录
records = [
    {'name':'李嘉倩','mentor':'乾书玉','dept1':'自营','dept2':'',
     'startDate':'2026-08-03','practiceDays':7,'deviceModel':'','serialNumber':'','accessories':'','remark':''},
    {'name':'王磊','mentor':'谭云松','dept1':'自营','dept2':'',
     'startDate':'2026-08-03','practiceDays':15,'deviceModel':'','serialNumber':'','accessories':'','remark':''},
    {'name':'杨佳','mentor':'邓龙翔','dept1':'自营','dept2':'自营D组',
     'startDate':'2026-07-27','practiceDays':5,'deviceModel':'','serialNumber':'','accessories':'','remark':''}
]
for r in records:
    req = urllib.request.Request(
        'https://practice-ledger.onrender.com/api/records',
        data=json.dumps(r, ensure_ascii=False).encode('utf-8'),
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json; charset=utf-8'},
        method='POST'
    )
    resp = urllib.request.urlopen(req, timeout=60)
    result = json.loads(resp.read().decode('utf-8'))
    rec = result.get('record', {})
    print(f'创建: {rec.get("name")} | ID: {rec.get("id")}')

# 立即读取
print()
req = urllib.request.Request(
    'https://practice-ledger.onrender.com/api/records',
    headers={'Authorization': 'Bearer ' + token}
)
resp = urllib.request.urlopen(req, timeout=60)
records = json.loads(resp.read().decode('utf-8'))['records']
print(f'立即读取: {len(records)} 条')

# 等待3次，每次都重新读取，确认数据持久
import time
for i in range(3):
    time.sleep(10)
    req = urllib.request.Request(
        'https://practice-ledger.onrender.com/api/records',
        headers={'Authorization': 'Bearer ' + token}
    )
    resp = urllib.request.urlopen(req, timeout=60)
    records = json.loads(resp.read().decode('utf-8'))['records']
    print(f'{10*(i+1)}秒后: {len(records)} 条')

# 最后强制刷一次dashboard诊断
print()
req = urllib.request.Request('https://practice-ledger.onrender.com/api/diagnostic')
resp = urllib.request.urlopen(req, timeout=60)
d = json.loads(resp.read().decode('utf-8'))
print(f'最终诊断: totalRecords={d["totalRecords"]}, activeRecords={d["activeRecords"]}')