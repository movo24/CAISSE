import { Controller, Get, Post, Delete, Query, Param, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsObject, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SavedFiltersService } from './saved-filters.service';

class SaveFilterDto {
  @IsString() @IsNotEmpty() @MaxLength(30)
  page: string;

  @IsString() @IsNotEmpty() @MaxLength(60)
  name: string;

  @IsOptional() @IsObject()
  config?: Record<string, unknown>;
}

@ApiTags('saved-filters')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/saved-filters')
export class SavedFiltersController {
  constructor(private readonly service: SavedFiltersService) {}

  @Get()
  @ApiOperation({ summary: 'List saved views/filters of the current employee (by page)' })
  list(@Query('page') page: string, @Request() req: any) {
    return this.service.list(req.user.employeeId, page || 'default');
  }

  @Post()
  @ApiOperation({ summary: 'Create or replace a saved view/filter (unique per employee+page+name)' })
  save(@Body() dto: SaveFilterDto, @Request() req: any) {
    return this.service.upsert(req.user.employeeId, dto.page, dto.name, dto.config ?? {});
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a saved view/filter by id (owner-scoped)' })
  remove(@Param('id') id: string, @Request() req: any) {
    return this.service.remove(req.user.employeeId, id);
  }
}
