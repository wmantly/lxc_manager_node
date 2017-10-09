# Random things not to lose

## Auto start

```crontab
@reboot /usr/local/bin/forever start -o /var/log/forver.out.log -e /var/log/sorver.err.log -c "/usr/local/bin/codebox run -p 5000" /workspace/`
```

## LXC permission issue

```bash
sudo cgm create all virt
sudo cgm chown all virt $(id -u virt) $(id -g virt)
```
