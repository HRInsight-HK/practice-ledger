"""
数据恢复脚本 - 通过 Render API 恢复 3 条丢失的实操记录
用法: python restore-records.py
"""
import requests
import json
import time
import sys

BASE_URL = "https://practice-ledger.onrender.com"

# 3 条丢失的记录
RECORDS = [
    {
        "name": "李嘉倩",
        "mentor": "乾书玉",
        "dept1": "自营",
        "startDate": "2026-07-28",
        "practiceDays": 7
    },
    {
        "name": "王磊",
        "mentor": "谭云松",
        "dept1": "自营",
        "startDate": "2026-07-28",
        "practiceDays": 15
    },
    {
        "name": "杨佳",
        "mentor": "邓龙翔",
        "dept1": "自营",
        "dept2": "D组",
        "startDate": "2026-07-28",
        "practiceDays": 5
    }
]


def check_deployed():
    """检查新代码是否已部署"""
    try:
        r = requests.get(f"{BASE_URL}/api/diagnostic", timeout=30)
        data = r.json()
        bv = data.get("buildVersion", "NOT FOUND")
        total = data.get("totalRecords", 0)
        print(f"  buildVersion: {bv}")
        print(f"  totalRecords: {total}")
        return bv != "NOT FOUND", total
    except Exception as e:
        print(f"  诊断请求失败: {e}")
        return False, 0


def login():
    """登录获取 JWT token"""
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": "admin", "password": "Zz741852"},
        timeout=30
    )
    if r.status_code != 200:
        print(f"  登录失败: {r.status_code} {r.text}")
        return None
    token = r.json().get("token")
    print(f"  登录成功, token: {token[:20]}...")
    return token


def create_record(token, record):
    """通过 API 创建记录"""
    r = requests.post(
        f"{BASE_URL}/api/records",
        json=record,
        headers={"Authorization": f"Bearer {token}"},
        timeout=30
    )
    if r.status_code == 200:
        data = r.json()
        print(f"  ✅ 创建成功: {record['name']} -> ID: {data.get('record', {}).get('id', 'N/A')}")
        if data.get("warning"):
            print(f"     ⚠️ {data['warning']}")
        return True
    else:
        print(f"  ❌ 创建失败: {r.status_code} {r.text}")
        return False


def main():
    print("=" * 50)
    print("  实操台账数据恢复脚本")
    print("=" * 50)

    # Step 1: 检查部署状态
    print("\n[1/3] 检查新代码部署状态...")
    deployed, total = check_deployed()

    if not deployed:
        print("\n❌ 新代码尚未部署到 Render！")
        print("   请在 Render 控制台手动触发部署：")
        print("   1. 打开 https://dashboard.render.com")
        print("   2. 找到 practice-ledger 服务")
        print("   3. 点击 'Manual Deploy' → 'Deploy latest commit'")
        print("   4. 等待构建完成（约2-5分钟）")
        print("   5. 重新运行此脚本")
        sys.exit(1)

    print("\n✅ 新代码已部署！")

    # Step 2: 登录
    print("\n[2/3] 登录系统...")
    token = login()
    if not token:
        sys.exit(1)

    # Step 3: 创建记录
    print("\n[3/3] 恢复 3 条记录...")
    success_count = 0
    for record in RECORDS:
        print(f"\n  正在创建: {record['name']} ({record['mentor']}/{record['dept1']}/{record['practiceDays']}天)")
        if create_record(token, record):
            success_count += 1
        time.sleep(0.5)  # 避免请求过快

    print(f"\n{'=' * 50}")
    print(f"  恢复完成: {success_count}/{len(RECORDS)} 条记录创建成功")

    # 验证
    print("\n  验证数据...")
    deployed, total = check_deployed()
    print(f"  当前总记录数: {total}")

    if total >= 3:
        print("\n✅ 数据恢复成功！")
    else:
        print(f"\n⚠️ 预期3条记录，实际{total}条，请检查")


if __name__ == "__main__":
    main()
