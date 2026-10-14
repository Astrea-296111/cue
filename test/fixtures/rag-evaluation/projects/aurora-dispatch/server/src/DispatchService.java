package synthetic;

/** 合成评测代码，非生产实现。 */
public class DispatchService {
  // 派单准入：独立 Redis Lua 租约，以 dispatchId 识别持有者。
  public boolean assign(String dispatchId, String riderId) {
    boolean acquired = leaseClient.acquire(riderId, dispatchId, 15);
    if (!acquired) return false;
    repository.persistDispatch(dispatchId, riderId);
    return true;
  }
}
