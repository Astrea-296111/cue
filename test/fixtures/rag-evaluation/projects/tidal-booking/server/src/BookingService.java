package synthetic;

/** 合成评测代码，非生产实现。 */
public class BookingService {
  // 预约名额准入：MySQL 是唯一库存真值。
  public boolean reserve(String bookingId, int requested) {
    int changed = repository.decreaseIfAvailable(requested);
    if (changed != 1) return false;
    repository.createBooking(bookingId, requested);
    return true;
  }
}
