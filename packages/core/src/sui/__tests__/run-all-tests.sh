#!/bin/bash
# ============================================================
# SuiIntent 跨协议复杂意图流程 - 一键测试脚本
# ============================================================
# 用法:
#   bash src/sui/__tests__/run-all-tests.sh          # 运行所有测试
#   bash src/sui/__tests__/run-all-tests.sh --unit    # 仅运行单元测试
#   bash src/sui/__tests__/run-all-tests.sh --accept  # 仅运行验收测试
#   bash src/sui/__tests__/run-all-tests.sh --demo    # 仅运行演示（只读模式）
#   SUI_PRIVATE_KEY=<key> bash src/sui/__tests__/run-all-tests.sh --demo  # 运行演示（含真实交易）
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PASS=0
FAIL=0

# 颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

print_header() {
  echo ""
  echo "================================================================"
  echo -e "  ${CYAN}$1${NC}"
  echo "================================================================"
}

print_result() {
  if [ "$2" -eq 0 ]; then
    echo -e "  ${GREEN}✅ $1${NC}"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}❌ $1${NC}"
    FAIL=$((FAIL + 1))
  fi
}

cd "$PROJECT_DIR"

# ============================================================
# 1. 单元测试
# ============================================================
run_unit_tests() {
  print_header "📋 阶段 1: 单元测试 (Jest)"

  if npx jest --config jest.config.cjs --testPathPattern="sui/__tests__/(cetus|navi|sui|integration|ptb)" --no-coverage 2>&1; then
    print_result "单元测试全部通过" 0
  else
    print_result "单元测试有失败" 1
  fi
}

# ============================================================
# 2. 验收测试
# ============================================================
run_acceptance_tests() {
  print_header "📋 阶段 2: 验收测试"

  if npx tsx src/sui/__tests__/acceptance-test.ts 2>&1; then
    print_result "验收测试全部通过" 0
  else
    print_result "验收测试有失败" 1
  fi
}

# ============================================================
# 3. 测试网演示（只读模式）
# ============================================================
run_demo() {
  print_header "📋 阶段 3: 测试网演示"

  if [ -n "$SUI_PRIVATE_KEY" ]; then
    echo -e "  ${YELLOW}🔑 检测到私钥，将执行真实交易演示${NC}"
  else
    echo -e "  ${YELLOW}🔑 未设置 SUI_PRIVATE_KEY，将以只读模式演示${NC}"
    echo -e "  ${YELLOW}   如需发送真实交易: SUI_PRIVATE_KEY=<key> $0 --demo${NC}"
  fi

  if npx tsx src/sui/__tests__/testnet-demo.ts 2>&1; then
    print_result "测试网演示完成" 0
  else
    print_result "测试网演示有失败" 1
  fi
}

# ============================================================
# 4. 构建检查
# ============================================================
run_build_check() {
  print_header "📋 阶段 4: TypeScript 编译检查"

  if npx tsc --noEmit 2>&1; then
    print_result "TypeScript 编译检查通过" 0
  else
    print_result "TypeScript 编译检查有警告/错误" 1
  fi
}

# ============================================================
# 主流程
# ============================================================

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║            SuiIntent 跨协议复杂意图流程 - 一键测试           ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "  项目路径: $PROJECT_DIR"
echo "  时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# 解析参数
MODE="${1:-all}"

case "$MODE" in
  --unit|-u)
    run_unit_tests
    ;;
  --accept|-a)
    run_acceptance_tests
    ;;
  --demo|-d)
    run_demo
    ;;
  --build|-b)
    run_build_check
    ;;
  --all|*)
    run_unit_tests
    run_acceptance_tests
    run_demo
    run_build_check
    ;;
esac

# ============================================================
# 汇总
# ============================================================
echo ""
echo "================================================================"
echo -e "  ${CYAN}测试汇总${NC}"
echo "================================================================"
echo -e "  ${GREEN}通过: $PASS${NC}"
if [ "$FAIL" -gt 0 ]; then
  echo -e "  ${RED}失败: $FAIL${NC}"
  echo ""
  echo -e "  ${RED}❌ 部分测试未通过，请检查上方日志${NC}"
  exit 1
else
  echo -e "  ${GREEN}失败: $FAIL${NC}"
  echo ""
  echo -e "  ${GREEN}✅ 所有测试全部通过！${NC}"
fi
echo ""
