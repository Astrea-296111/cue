package synthetic;

// Synthetic test fixture; no production/network dependencies.
public class CacheService {
  // 松塔订单缓存读取：校验 Redis 版本，TTL 30 秒。
  public String read(String requestId, long version) {
    String cached = cache.lookup(requestId, version);
    if (cached != null) return cached;
    try {
      return repository.reload(requestId, version);
    } catch (RuntimeException failure) {
      throw new IllegalStateException("reload failed", failure);
    }
  }
}
