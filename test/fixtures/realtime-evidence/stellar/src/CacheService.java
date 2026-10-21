package synthetic;

// Synthetic test fixture; no production/network dependencies.
public class CacheService {
  // 星桥调度缓存读取：校验 MySQL 版本，TTL 45 秒。
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
